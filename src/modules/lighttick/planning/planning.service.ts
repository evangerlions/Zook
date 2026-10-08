import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import { LightTickProgressiveService } from "../lighttick-progressive.service.ts";
import { LightTickTaskService } from "../lighttick-task.service.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { LIGHTTICK_AI_SCENES } from "../ai/lighttick-ai-scenes.ts";
import { canonical, missing, planningError, positiveVersion, readyState, text, validField, validatePeriod } from "./planning-context.ts";
import type { PlanningContext, PlanningField, PlanningSession } from "./planning.types.ts";

type Input = Record<string, any>;
export class LightTickPlanningService {
  constructor(readonly repository: LightTickRepository, readonly clock = () => new Date()) {}
  async get(owner: LightTickOwner, id: string) {
    const session = await this.repository.getPlanningSession(owner, id);
    if (!session) planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Planning session was not found.");
    return session!;
  }
  async command(owner: LightTickOwner, operationId: string, action: string, id: string | undefined, input: Input) {
    text(operationId, 128); const hash = sha256(canonical({ action, id: id ?? null, input }));
    return await this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      const key = `planning:${operationId}`;
      const existing = await this.repository.getOperation(owner, key);
      if (existing) {
        if (existing.payloadHash !== hash) planningError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Operation key was reused with different input.");
        return existing.resultPayload as unknown as { session: PlanningSession; run?: LightTickAiRunRow };
      }
      let session: PlanningSession;
      let run: LightTickAiRunRow | undefined;
      if (action === "create") session = await this.create(owner, input);
      else {
        session = await this.get(owner, id!);
        if (positiveVersion(input.base_version) !== session.version) planningError(409, "LIGHTTICK_VERSION_CONFLICT", "Session changed; reload it.");
        if (session.status === "confirmed") planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "This session has already been confirmed.");
        if (action === "context") session = await this.patch(session, input.fields);
        else if (action === "messages" || action === "drafts") ({ session, run } = await this.start(session, action, input));
        else if (action === "confirm") session = await this.confirm(session, input);
        else planningError(400, "REQ_FIELD_INVALID", "Unknown planning operation.");
      }
      const result = { session, ...(run ? { run } : {}) }; const now = this.clock().toISOString();
      await this.repository.saveOperation({ ...owner, operationId: key, deviceId: "planning", payloadHash: hash,
        entityType: "planning_session", entityId: session.id, action, requestPayload: {}, resultPayload: result as any,
        status: "accepted", createdAt: now, updatedAt: now });
      return result;
    });
  }
  private async create(owner: LightTickOwner, input: Input) {
    const goal = await this.repository.getGoal(owner, text(input.goal_id, 200));
    if (!goal) planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const now = this.clock().toISOString(); const context: PlanningContext = { objective: { value: goal!.title, source: "imported" } };
    const minutes = goal!.constraints.weekly_available_minutes;
    if (Number.isInteger(minutes) && Number(minutes) > 0 && Number(minutes) <= 10080) context.available_minutes = { value: Number(minutes), source: "imported" };
    return await this.repository.savePlanningSession(readyState({ ...owner, id: randomId("planning"), goalId: goal!.id,
      threadId: randomId("planning_thread"), status: "collecting", version: 1, contextRevision: 1, context,
      questions: [], clarificationRounds: 0, createdAt: now, updatedAt: now }));
  }
  private async patch(session: PlanningSession, fields: unknown) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) planningError(400, "REQ_FIELD_INVALID", "Context fields are required.");
    const context = structuredClone(session.context);
    for (const [key, entry] of Object.entries(fields as Input)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k=>!["value","source"].includes(k)) || !["user", "confirmed"].includes(entry.source)) planningError(400, "REQ_FIELD_INVALID", "User updates require user or confirmed source.");
      context[key as PlanningField] = { value: validField(key, entry.value), source: entry.source };
    }
    validatePeriod(context);
    return await this.save(readyState({ ...session, context, contextRevision: session.contextRevision + 1,
      draftPlanId: undefined, draftRevision: undefined, draftExpiresAt: undefined, lastError: undefined }));
  }
  async snapshot(owner: LightTickOwner, goalId: string) {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const plans = (await this.repository.listPlans(owner, goalId)).filter(p => p.status === "active");
    const ids = new Set(plans.map(p=>p.id));
    const tasks = (await this.repository.listTasks(owner)).filter(t=>ids.has(t.planId));
    return sha256(canonical({ goal: [goal!.id,goal!.version,goal!.status], plans: plans.map(p=>[p.id,p.version]).sort(), tasks: tasks.map(t=>[t.id,t.version]).sort() }));
  }
  private async start(session: PlanningSession, action: "messages" | "drafts", input: Input) {
    if (session.activeRunId) planningError(409, "LIGHTTICK_PLANNING_BUSY", "Wait for the current operation before starting another.");
    let message = action === "messages" ? text(input.message) : input.instruction === undefined ? undefined : text(input.instruction);
    let messageId: string | undefined;
    if (action === "drafts") {
      if (positiveVersion(input.context_revision) !== session.contextRevision) planningError(409, "LIGHTTICK_VERSION_CONFLICT", "Context changed.");
      if (missing(session.context).length) planningError(409, "LIGHTTICK_PLANNING_NOT_READY", "Review the required context before generating.");
      const profile = await this.repository.getProfile(session);
      const eligibility = await new LightTickProgressiveService(this.repository, new LightTickTaskService(this.repository), this.clock).commitmentState(session);
      if (!eligibility.eligible && !profile?.onboardingDraft.commitment_mode && input.deep_planning !== true)
        planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Explicit deep planning or existing commitment eligibility is required.");
    }
    if (message) {
      messageId = randomId("lighttick_chat");
      await this.repository.saveChatMessage({ appId: session.appId, userId: session.userId, goalId: session.goalId, threadId: session.threadId, id: messageId, role: "user", content: message, createdAt: this.clock().toISOString() });
    }
    const name = action === "messages" ? "planning_clarify" : "week_plan";
    const scene = LIGHTTICK_AI_SCENES[name]; const now = this.clock().toISOString();
    const history = (await this.repository.listChatMessages(session, session.threadId, 8, session.goalId)).map(m=>({ role:m.role, content:m.content.slice(0,1000) }));
    const prior = session.draftPlanId ? await this.repository.getPlan(session, session.draftPlanId) : undefined;
    const run = await this.repository.saveAiRun({ appId: session.appId, userId: session.userId, id: randomId("lighttick_run"), kind: action === "messages" ? "coach_reply" : "plan",
      status: "queued", sceneKey: scene.key, promptVersion: scene.promptVersion, schemaVersion: scene.schemaVersion, attemptCount: 0,
      inputContext: { planning_session_id: session.id, context_revision: session.contextRevision, goal_id: session.goalId,
        planning_action: action, context: structuredClone(session.context), conversation: history, message, source_message_id: messageId,
        previous_draft: prior ? prior.proposal.tasks : undefined, snapshot: await this.snapshot(session, session.goalId) },
      usage: {}, createdAt: now, updatedAt: now });
    const saved = await this.save({ ...session, status: "generating", activeRunId: run.id, lastError: undefined });
    return { session: saved, run };
  }
  private async confirm(session: PlanningSession, input: Input) {
    if (session.activeRunId || session.status !== "draft_ready" || input.draft_plan_id !== session.draftPlanId ||
      positiveVersion(input.context_revision) !== session.contextRevision || session.draftRevision !== session.contextRevision)
      planningError(409, "LIGHTTICK_PLANNING_STALE", "The draft is not current; generate a new preview.");
    if (!session.draftExpiresAt || session.draftExpiresAt <= this.clock().toISOString()) planningError(409, "LIGHTTICK_PLANNING_STALE", "The draft expired.");
    if (await this.snapshot(session, session.goalId) !== session.baseSnapshot) planningError(409, "LIGHTTICK_VERSION_CONFLICT", "The goal or active plan changed; generate a refreshed draft.");
    const goal = await this.repository.getGoal(session, session.goalId);
    if (!goal || !["active", "draft"].includes(goal.status)) planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Goal cannot accept a plan in its current state.");
    const draft = await this.repository.getPlan(session, session.draftPlanId!);
    if (!draft || draft.goalId !== session.goalId || draft.proposal.planning_session_id !== session.id)
      planningError(409, "LIGHTTICK_PLANNING_STALE", "Draft ownership no longer matches.");
    await new LightTickPlanService(this.repository, this.clock).confirm(session, draft.id, positiveVersion(input.plan_version), session.id);
    return await this.save({ ...session, status: "confirmed", lastError: undefined });
  }
  async failRun(owner: LightTickOwner, runId: string) {
    await this.repository.transaction(owner, async()=>{
      await this.repository.lockPlanningOwner(owner);
      const run=await this.repository.getAiRun(owner,runId);
      if (!run?.inputContext.planning_session_id || ["succeeded","failed"].includes(run.status)) return;
      const session=await this.repository.getPlanningSession(owner,String(run.inputContext.planning_session_id));
      if (session?.activeRunId===runId) await this.save(readyState({...session,activeRunId:undefined,lastError:"LIGHTTICK_AI_UNAVAILABLE"}));
      await this.repository.saveAiRun({...run,status:"failed",errorCode:"LIGHTTICK_AI_UNAVAILABLE",completedAt:this.clock().toISOString(),updatedAt:this.clock().toISOString()});
    });
  }
  async save(session: PlanningSession) {
    return await this.repository.savePlanningSession({ ...session, updatedAt: this.clock().toISOString() }, session.version);
  }
}

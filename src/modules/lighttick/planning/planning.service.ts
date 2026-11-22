import {captureModel} from "../personal-model/personal-model.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickGoalRow, LightTickOwner } from "../lighttick.types.ts";
import { LightTickGoalService } from "../lighttick-goal.service.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import { LightTickProgressiveService } from "../lighttick-progressive.service.ts";
import { LightTickTaskService } from "../lighttick-task.service.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { addDays } from "../growth/lighttick-growth.service.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { LIGHTTICK_AI_SCENES } from "../ai/lighttick-ai-scenes.ts";
import { canonical, missing, planningError, planningStageId, positiveVersion, readyState, text, validField, validatePeriod } from "./planning-context.ts";
import type { PlanningContext, PlanningField, PlanningSession } from "./planning.types.ts";

import { editPlanningDraft } from "./planning-draft-edit.ts";
import { effectiveDailyLimits } from "../goal-context/confirmed-conditions.ts";
import { validatePlanOutput } from "../ai/lighttick-ai-validation.ts";
import { assertRoadmapPlacement } from "./roadmap-placement.ts";

type Input = Record<string, any>;
export class LightTickPlanningService {
  constructor(readonly repository: LightTickRepository, readonly clock = () => new Date()) {}
  async get(owner: LightTickOwner, id: string) {
    const session = await this.repository.getPlanningSession(owner, id);
    if (!session) planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Planning session was not found.");
    return session!;
  }
  async list(owner: LightTickOwner, requestedLimit?: string, goalId?: string, stageId?: string) {
    const limit = requestedLimit === undefined ? 25 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      planningError(400, "REQ_FIELD_INVALID", "Planning session limit must be between 1 and 100.");
    }
    if (stageId !== undefined && goalId === undefined) {
      planningError(400, "REQ_FIELD_INVALID", "A roadmap stage requires an existing goal.");
    }
    return this.repository.listPlanningSessions(owner, limit, goalId === undefined ? undefined : text(goalId, 200),
      stageId === undefined ? undefined : planningStageId(stageId));
  }
  async command(owner: LightTickOwner, operationId: string, action: string, id: string | undefined, input: Input, authorize: () => Promise<void> = async () => {}, browserGenerationId?: string) {
    text(operationId, 128); const hash = sha256(canonical({ action, id: id ?? null, input }));
    return await this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      await authorize();
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
        else if (action === "messages" || action === "drafts") ({ session, run } = await this.start(session, action, input, browserGenerationId));
        else if (action === "draft") {
          if (await this.snapshot(session,session.goalId) !== session.baseSnapshot) planningError(409,"LIGHTTICK_VERSION_CONFLICT","The goal or existing work changed; regenerate before editing.");
          session = await this.save(await editPlanningDraft(this.repository,session,input,this.clock().toISOString()));
        }
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
    if ((input.goal_id !== undefined) === (input.goal_title !== undefined) ||
      ((input.previous_plan_id !== undefined || input.stage_id !== undefined) && input.goal_id === undefined)) {
      planningError(400, "REQ_FIELD_INVALID", "Choose an existing goal or a new goal title. A previous plan or roadmap stage requires an existing goal.");
    }
    const goal = input.goal_id === undefined
      ? await new LightTickGoalService(this.repository, this.clock).create(owner, { title: text(input.goal_title, 200), constraints: {} })
      : await this.repository.getGoal(owner, text(input.goal_id, 200));
    if (!goal) planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const now = this.clock().toISOString(); const context: PlanningContext = { objective: { value: goal!.title, source: "imported" } };
    const minutes = goal!.constraints.weekly_available_minutes;
    if (Number.isInteger(minutes) && Number(minutes) > 0 && Number(minutes) <= 10080) context.available_minutes = { value: Number(minutes), source: "imported" };
    const previousPlanId = input.previous_plan_id === undefined ? undefined : text(input.previous_plan_id, 200);
    const stageId = input.stage_id === undefined ? undefined : planningStageId(input.stage_id);
    const stage = stageId && this.selectRoadmapStage(goal!, stageId);
    if (previousPlanId || stage) {
      const previous = previousPlanId && await this.followUpSource(owner, goal!.id, previousPlanId);
      const timezone = (await this.repository.getProfile(owner))?.timezone ?? "UTC";
      const currentDay = businessDateAt(new Date(now), timezone);
      const earliest = previous ? addDays(previous.periodEnd, 1) : currentDay;
      const base = earliest > currentDay ? earliest : currentDay;
      const start = stage && stage.starts_on && stage.starts_on > base ? stage.starts_on : base;
      const weekEnd = addDays(start, 6);
      const deadline = stage ? goal!.targetDate?.slice(0, 10) : undefined;
      const stageEnd = stage && stage.ends_on && stage.ends_on < weekEnd ? stage.ends_on : weekEnd;
      const end = dateOnly(deadline) && deadline < stageEnd ? deadline : stageEnd;
      if (end < start) planningError(422, "LIGHTTICK_ROADMAP_STAGE_WINDOW", "No upcoming dates fit this stage.");
      context.period_start = { value: start, source: "imported" };
      context.period_end = { value: end, source: "imported" };
    }
    return await this.repository.savePlanningSession(readyState({ ...owner, id: randomId("planning"), goalId: goal!.id,
      threadId: randomId("planning_thread"), status: "collecting", version: 1, contextRevision: 1, context,
      questions: [], clarificationRounds: 0, createdAt: now, updatedAt: now,
      ...(previousPlanId ? { previousPlanId } : {}), ...(stageId ? { stageId } : {}) }));
  }
  private async followUpSource(owner: LightTickOwner, goalId: string, previousPlanId: string) {
    const previous = await this.repository.getPlan(owner, previousPlanId);
    if (!previous || previous.goalId !== goalId) {
      return planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "The previous plan was not found for this goal.");
    }
    if ((await this.repository.getGoal(owner, goalId))?.status !== "active") {
      planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Only an active goal can plan a follow-up cycle.");
    }
    if (previous.status !== "active" || previous.granularity === "day" || previous.source === "learning_schedule" ||
      !dateOnly(previous.periodStart) || !dateOnly(previous.periodEnd) || previous.periodStart > previous.periodEnd) {
      planningError(409, "LIGHTTICK_PLANNING_STALE", "Review the current confirmed cycle before planning the next one.");
    }
    const plans = await this.repository.listPlans(owner, goalId);
    if (plans.some(plan => plan.status === "active" && plan.granularity !== "day" &&
      plan.source !== "learning_schedule" && dateOnly(plan.periodStart) && plan.periodStart > previous.periodStart)) {
      planningError(409, "LIGHTTICK_PLANNING_STALE", "A newer confirmed cycle already exists for this goal.");
    }
    return previous;
  }
  private async checkFollowUp(session: PlanningSession, context = session.context) {
    if (!session.previousPlanId) return;
    const source = await this.followUpSource(session, session.goalId, session.previousPlanId);
    if (typeof context.period_start?.value !== "string" || context.period_start.value <= source.periodEnd) {
      planningError(400, "REQ_FIELD_INVALID", "The follow-up period must begin after the previous cycle ends.");
    }
  }
  private selectRoadmapStage(goal: LightTickGoalRow, stageId: string, start?: string, end?: string) {
    if (!["draft", "active"].includes(goal.status))
      planningError(409, "LIGHTTICK_ROADMAP_STAGE_UNAVAILABLE", "The goal cannot accept a new plan in this stage.");
    return assertRoadmapPlacement(goal, stageId, start, end);
  }
  private async checkRoadmapStage(session: PlanningSession, context = session.context) {
    if (!session.stageId) return;
    const goal = await this.repository.getGoal(session, session.goalId);
    if (!goal) return planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const start = context.period_start?.value;
    const end = context.period_end?.value;
    return this.selectRoadmapStage(goal, session.stageId, typeof start === "string" ? start : undefined,
      typeof end === "string" ? end : undefined);
  }
  private async patch(session: PlanningSession, fields: unknown) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) planningError(400, "REQ_FIELD_INVALID", "Context fields are required.");
    const context = structuredClone(session.context);
    for (const [key, entry] of Object.entries(fields as Input)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(k=>!["value","source"].includes(k)) || !["user", "confirmed"].includes(entry.source)) planningError(400, "REQ_FIELD_INVALID", "User updates require user or confirmed source.");
      context[key as PlanningField] = { value: validField(key, entry.value), source: entry.source };
    }
    validatePeriod(context);
    await this.checkFollowUp(session, context);
    await this.checkRoadmapStage(session, context);
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
  private async start(session: PlanningSession, action: "messages" | "drafts", input: Input, browserGenerationId?: string) {
    if (session.activeRunId) planningError(409, "LIGHTTICK_PLANNING_BUSY", "Wait for the current operation before starting another.");
    await this.checkFollowUp(session);
    const stage = await this.checkRoadmapStage(session);
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
      status: browserGenerationId ? "running" : "queued", sceneKey: scene.key, promptVersion: scene.promptVersion, schemaVersion: scene.schemaVersion,
      attemptCount: browserGenerationId ? 1 : 0, startedAt: browserGenerationId ? now : undefined,
      inputContext: { ...(browserGenerationId ? { browser_generation_id: browserGenerationId } : { model_selection: await captureModel(this.repository,session) }), planning_session_id: session.id, context_revision: session.contextRevision, goal_id: session.goalId,
        ...(stage ? { roadmap_stage: { title: stage.title, outcome_criteria: stage.outcome_criteria,
          starts_on: stage.starts_on, ends_on: stage.ends_on } } : {}),
        confirmed_daily_limits: await this.dailyLimits(session), planning_action: action, context: structuredClone(session.context), conversation: history, message, source_message_id: messageId,
        previous_draft: prior ? prior.proposal.tasks : undefined, snapshot: await this.snapshot(session, session.goalId) },
      usage: {}, createdAt: now, updatedAt: now });
    const saved = await this.save({ ...session, status: "generating", activeRunId: run.id, lastError: undefined });
    return { session: saved, run };
  }
  private async dailyLimits(session: PlanningSession) {
    const goal=await this.repository.getGoal(session,session.goalId);
    const start=session.context.period_start?.value,end=session.context.period_end?.value;
    if (!goal || goal.constraints.confirmed_planning_conditions === undefined || typeof start!=='string' || typeof end!=='string') return [];
    const limits: ReturnType<typeof effectiveDailyLimits> = [];
    for(let date=start;date<=end;) {
      const stop=new Date(Date.parse(date)+30*86400000).toISOString().slice(0,10);
      limits.push(...effectiveDailyLimits(goal,date,stop<end?stop:end));
      date=new Date(Date.parse(date)+31*86400000).toISOString().slice(0,10);
    }
    return limits;
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
    if (!draft || draft.goalId !== session.goalId || draft.proposal.planning_session_id !== session.id ||
      draft.proposal.stage_id !== session.stageId)
      planningError(409, "LIGHTTICK_PLANNING_STALE", "Draft ownership no longer matches.");
    await this.checkFollowUp(session);
    if (session.stageId) this.selectRoadmapStage(goal!, session.stageId, draft!.periodStart, draft!.periodEnd);
    validatePlanOutput({tasks:(draft!.proposal.tasks as any[]).map(t=>({title:t.title,estimated_minutes:t.estimatedMinutes,scheduled_for:t.scheduledFor,completion_criteria:t.completionCriteria,steps:t.steps,guidance:t.guidance}))}, {availableMinutes:Number(session.context.available_minutes!.value),periodStart:draft!.periodStart.slice(0,10),periodEnd:draft!.periodEnd.slice(0,10),timezone:(await this.repository.getProfile(session))?.timezone ?? 'UTC'});
    await new LightTickPlanService(this.repository, this.clock).confirm(session, draft!.id, positiveVersion(input.plan_version), session.id);
    return await this.save({ ...session, status: "confirmed", lastError: undefined });
  }
  async failRun(owner: LightTickOwner, runId: string, browserFailure?: string) {
    await this.repository.transaction(owner, async()=>{
      await this.repository.lockPlanningOwner(owner);
      const run=await this.repository.getAiRun(owner,runId);
      if (!run?.inputContext.planning_session_id || ["succeeded","failed"].includes(run.status) ||
        (!!run.inputContext.browser_generation_id !== !!browserFailure)) return;
      const failure = browserFailure ?? "LIGHTTICK_AI_UNAVAILABLE";
      const session=await this.repository.getPlanningSession(owner,String(run.inputContext.planning_session_id));
      if (session?.activeRunId===runId) await this.save(readyState({...session,activeRunId:undefined,lastError:failure}));
      await this.repository.saveAiRun({...run,status:"failed",errorCode:failure,completedAt:this.clock().toISOString(),updatedAt:this.clock().toISOString()});
    });
  }
  async save(session: PlanningSession) {
    return await this.repository.savePlanningSession({ ...session, updatedAt: this.clock().toISOString() }, session.version);
  }
}

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
import { canonical, missing, planningError, planningStageId, planningSubjectId, positiveVersion, readyState, text, validField, validatePeriod, validatePlanningModes } from "./planning-context.ts";
import { PLANNING_FIELDS, type PlanningContext, type PlanningField, type PlanningSession } from "./planning.types.ts";
import { reviewExistingPlan } from "./planning-personal-context.ts";

import { editPlanningDraft } from "./planning-draft-edit.ts";
import { effectiveDailyLimits } from "../goal-context/confirmed-conditions.ts";
import { validatePlanOutput } from "../ai/lighttick-ai-validation.ts";
import { savedActionBriefConstraints } from "./planning-action-brief.ts";
import { assertGoalDeadlinePlacement, assertRoadmapPlacement } from "./roadmap-placement.ts";
import { assertSubjectPlacement, subjectIdForPlan } from "./goal-subjects.ts";
import { readPlannedRestDates } from "./planned-rest.ts";
import { readUnavailablePlanningDates } from "./planning-availability.ts";
import type { PlanningCalendarForGeneration } from "./planning-ai-generation.ts";

type Input = Record<string, any>;

function planningGoalEnded(goal: LightTickGoalRow) {
  return goal.status === "completed" || goal.status === "archived";
}

function writablePlanningGoal(goal: LightTickGoalRow | undefined): LightTickGoalRow {
  if (!goal) return planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
  if (planningGoalEnded(goal))
    return planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "A completed or archived goal keeps its planning history read-only.");
  return goal;
}

export class LightTickPlanningService {
  constructor(readonly repository: LightTickRepository, readonly clock = () => new Date()) {}
  async get(owner: LightTickOwner, id: string) {
    const session = await this.repository.getPlanningSession(owner, id);
    if (!session) planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Planning session was not found.");
    return session!;
  }
  async read(owner: LightTickOwner, id: string) {
    return await this.repository.transaction(owner, async () => {
      await this.repository.lockPlanningOwner(owner);
      const session = await this.get(owner, id);
      const goal = await this.repository.getGoal(owner, session.goalId);
      const existingPlanReview = await reviewExistingPlan(this.repository, session);
      return { session: { ...session, existingPlanReview }, targetDate: goal?.targetDate?.slice(0, 10),
        goalWritable: !!goal && !planningGoalEnded(goal) };
    });
  }
  async list(owner: LightTickOwner, requestedLimit?: string, goalId?: string, stageId?: string, subjectId?: string) {
    const limit = requestedLimit === undefined ? 25 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      planningError(400, "REQ_FIELD_INVALID", "Planning session limit must be between 1 and 100.");
    }
    if ((stageId !== undefined || subjectId !== undefined) && goalId === undefined) {
      planningError(400, "REQ_FIELD_INVALID", "A roadmap stage or planning subject requires an existing goal.");
    }
    return this.repository.listPlanningSessions(owner, limit, goalId === undefined ? undefined : text(goalId, 200),
      stageId === undefined ? undefined : planningStageId(stageId),
      subjectId === undefined ? undefined : planningSubjectId(subjectId));
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
        return existing.resultPayload as unknown as { session: PlanningSession; run?: LightTickAiRunRow; targetDate?: string };
      }
      let session: PlanningSession;
      let goal: LightTickGoalRow;
      let run: LightTickAiRunRow | undefined;
      if (action === "create") ({ session, goal } = await this.create(owner, input));
      else {
        session = await this.get(owner, id!);
        goal = writablePlanningGoal(await this.repository.getGoal(owner, session.goalId));
        if (positiveVersion(input.base_version) !== session.version) planningError(409, "LIGHTTICK_VERSION_CONFLICT", "Session changed; reload it.");
        if (session.status === "confirmed") planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "This session has already been confirmed.");
        if (action === "context") session = await this.patch(session, input.fields);
        else if (action === "messages" || action === "drafts") ({ session, run } = await this.start(session, goal, action, input, browserGenerationId));
        else if (action === "draft") {
          if (await this.snapshot(session,session.goalId) !== session.baseSnapshot) planningError(409,"LIGHTTICK_VERSION_CONFLICT","The goal or existing work changed; regenerate before editing.");
          session = await this.save(await editPlanningDraft(this.repository,session,input,this.clock().toISOString()));
        }
        else if (action === "confirm") session = await this.confirm(session, input);
        else planningError(400, "REQ_FIELD_INVALID", "Unknown planning operation.");
      }
      const targetDate = goal.targetDate?.slice(0, 10);
      const result = { session, ...(run ? { run } : {}), ...(dateOnly(targetDate) ? { targetDate } : {}) };
      const now = this.clock().toISOString();
      await this.repository.saveOperation({ ...owner, operationId: key, deviceId: "planning", payloadHash: hash,
        entityType: "planning_session", entityId: session.id, action, requestPayload: {}, resultPayload: result as any,
        status: "accepted", createdAt: now, updatedAt: now });
      return result;
    });
  }
  private async create(owner: LightTickOwner, input: Input) {
    const scopedDates = input.period_start !== undefined || input.period_end !== undefined;
    if (scopedDates && (input.stage_id === undefined || input.previous_plan_id !== undefined ||
      !dateOnly(input.period_start) || !dateOnly(input.period_end) || input.period_start > input.period_end ||
      Date.parse(input.period_end) - Date.parse(input.period_start) > 30 * 86_400_000)) {
      planningError(400, "REQ_FIELD_INVALID", "Choose both dates for a new stage plan of at most 31 days.");
    }
    if ((input.goal_id !== undefined) === (input.goal_title !== undefined) ||
      ((input.previous_plan_id !== undefined || input.stage_id !== undefined || input.subject_id !== undefined) && input.goal_id === undefined)) {
      planningError(400, "REQ_FIELD_INVALID", "Choose an existing goal or a new goal title. A previous plan, roadmap stage or subject requires an existing goal.");
    }
    const goal = writablePlanningGoal(input.goal_id === undefined
      ? await new LightTickGoalService(this.repository, this.clock).create(owner, { title: text(input.goal_title, 200), constraints: {} })
      : await this.repository.getGoal(owner, text(input.goal_id, 200)));
    const now = this.clock().toISOString(); const context: PlanningContext = { objective: { value: goal.title, source: "imported" } };
    const previousPlanId = input.previous_plan_id === undefined ? undefined : text(input.previous_plan_id, 200);
    const previous = previousPlanId ? await this.followUpSource(owner, goal.id, previousPlanId) : undefined;
    const previousSubject = previous && subjectIdForPlan(previous);
    const requestedSubject = input.subject_id === undefined ? undefined : planningSubjectId(input.subject_id);
    if (previous && requestedSubject && requestedSubject !== previousSubject)
      planningError(409, "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE", "A follow-up must keep the subject of its previous plan.");
    const subjectId = requestedSubject ?? previousSubject;
    const subject = subjectId ? this.selectSubject(goal, subjectId) : undefined;
    const goalMinutes = goal.constraints.weekly_available_minutes;
    const target = [goalMinutes, subject?.weekly_minutes].filter((minutes): minutes is number =>
      typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 && minutes <= 10080);
    if (target.length && subject?.weekly_minutes !== 0)
      context.available_minutes = { value: Math.min(...target), source: "imported" };
    const stageId = input.stage_id === undefined ? undefined : planningStageId(input.stage_id);
    const stage = stageId && this.selectRoadmapStage(goal, stageId);
    if (previous || stage || subject) {
      const timezone = (await this.repository.getProfile(owner))?.timezone ?? "UTC";
      const currentDay = businessDateAt(new Date(now), timezone);
      const earliest = previous ? addDays(previous.periodEnd, 1) : currentDay;
      const base = earliest > currentDay ? earliest : currentDay;
      const start = scopedDates ? String(input.period_start) :
        stage && stage.starts_on && stage.starts_on > base ? stage.starts_on : base;
      const weekEnd = addDays(start, 6);
      const deadline = stage || subject ? goal.targetDate?.slice(0, 10) : undefined;
      const stageEnd = stage && stage.ends_on && stage.ends_on < weekEnd ? stage.ends_on : weekEnd;
      const end = scopedDates ? String(input.period_end) : dateOnly(deadline) && deadline < stageEnd ? deadline : stageEnd;
      if (end < start || start < base) planningError(422, stage ? "LIGHTTICK_ROADMAP_STAGE_WINDOW" : "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
        "No upcoming dates fit the selected scope.");
      if (scopedDates && stageId) this.selectRoadmapStage(goal, stageId, start, end);
      context.period_start = { value: start, source: "imported" };
      context.period_end = { value: end, source: "imported" };
    }
    const session = await this.repository.savePlanningSession(readyState({ ...owner, id: randomId("planning"), goalId: goal.id,
      threadId: randomId("planning_thread"), status: "collecting", version: 1, contextRevision: 1, context,
      questions: [], clarificationRounds: 0, createdAt: now, updatedAt: now,
      ...(previousPlanId ? { previousPlanId } : {}), ...(stageId ? { stageId } : {}), ...(subjectId ? { subjectId } : {}) }));
    return { session, goal };
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
      plan.source !== "learning_schedule" && subjectIdForPlan(plan) === subjectIdForPlan(previous) &&
      dateOnly(plan.periodStart) && plan.periodStart > previous.periodStart)) {
      planningError(409, "LIGHTTICK_PLANNING_STALE", "A newer confirmed cycle already exists for this goal.");
    }
    return previous;
  }
  private async checkFollowUp(session: PlanningSession, context = session.context) {
    if (!session.previousPlanId) return;
    const source = await this.followUpSource(session, session.goalId, session.previousPlanId);
    if (subjectIdForPlan(source) !== session.subjectId)
      planningError(409, "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE", "Review the subject on the previous plan.");
    if (typeof context.period_start?.value === "string" && context.period_start.value <= source.periodEnd) {
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
  private selectSubject(goal: LightTickGoalRow, subjectId: string) {
    if (!["draft", "active"].includes(goal.status))
      return planningError(409, "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE", "The goal cannot accept a new plan for this subject.");
    return assertSubjectPlacement(goal, subjectId);
  }
  private async checkSubject(session: PlanningSession) {
    if (!session.subjectId) return;
    const goal = await this.repository.getGoal(session, session.goalId);
    if (!goal) return planningError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    return this.selectSubject(goal, session.subjectId);
  }
  private async patch(session: PlanningSession, fields: unknown) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) planningError(400, "REQ_FIELD_INVALID", "Context fields are required.");
    const context = structuredClone(session.context);
    for (const [key, entry] of Object.entries(fields as Input)) {
      if (!(PLANNING_FIELDS as readonly string[]).includes(key) || !entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some(k=>!["value","source"].includes(k)) || !["user", "confirmed"].includes(entry.source))
        planningError(400, "REQ_FIELD_INVALID", "Choose a supported planning field and user or confirmed source.");
      const field = key as PlanningField;
      if (entry.value === null) delete context[field];
      else context[field] = { value: validField(key, entry.value), source: key === "existing_plan" ? "imported" : entry.source };
    }
    const submitted = fields as Input;
    if (submitted.mode?.value === null && submitted.secondary_mode === undefined) delete context.secondary_mode;
    validatePeriod(context);
    validatePlanningModes(context);
    await this.checkFollowUp(session, context);
    await this.checkRoadmapStage(session, context);
    await this.checkSubject(session);
    const next = { ...session, context };
    const existingPlanReview = await reviewExistingPlan(this.repository, next);
    return await this.save(readyState({ ...next, existingPlanReview, contextRevision: session.contextRevision + 1,
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
  private async start(session: PlanningSession, goal: LightTickGoalRow, action: "messages" | "drafts", input: Input, browserGenerationId?: string) {
    if (session.activeRunId) planningError(409, "LIGHTTICK_PLANNING_BUSY", "Wait for the current operation before starting another.");
    await this.checkFollowUp(session);
    const stage = await this.checkRoadmapStage(session);
    const subject = await this.checkSubject(session);
    let message = action === "messages" ? text(input.message) : input.instruction === undefined ? undefined : text(input.instruction);
    let messageId: string | undefined;
    let calendar: PlanningCalendarForGeneration | undefined;
    const includeFramework = action === "drafts" && input.include_framework === true;
    const includeActionBrief = action === "drafts" && input.include_action_brief === true;
    const targetDate = includeFramework ? goal.targetDate?.slice(0, 10) : undefined;
    if (action === "drafts") {
      if (input.include_framework !== undefined && typeof input.include_framework !== "boolean")
        planningError(400, "REQ_FIELD_INVALID", "include_framework must be a boolean.");
      if (input.include_action_brief !== undefined && typeof input.include_action_brief !== "boolean")
        planningError(400, "REQ_FIELD_INVALID", "include_action_brief must be a boolean.");
      if (positiveVersion(input.context_revision) !== session.contextRevision) planningError(409, "LIGHTTICK_VERSION_CONFLICT", "Context changed.");
      if (missing(session.context).length) planningError(409, "LIGHTTICK_PLANNING_NOT_READY", "Review the required context before generating.");
      if (!stage) assertGoalDeadlinePlacement(goal, String(session.context.period_end!.value));
      const profile = await this.repository.getProfile(session);
      const eligibility = await new LightTickProgressiveService(this.repository, new LightTickTaskService(this.repository), this.clock).commitmentState(session);
      if (!eligibility.eligible && !profile?.onboardingDraft.commitment_mode && input.deep_planning !== true)
        planningError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Explicit deep planning or existing commitment eligibility is required.");
      calendar = await this.generationCalendar(session, profile?.timezone ?? "UTC");
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
        ...(subject ? { planning_subject_id: subject.id, goal_subject: { title: subject.title,
          outcome_criteria: subject.outcome_criteria, priority: subject.priority, weekly_minutes: subject.weekly_minutes } } : {}),
        ...(calendar ? { planning_calendar: calendar } : {}),
        ...(includeActionBrief ? { include_action_brief: true } : {}),
        ...(includeFramework ? { include_framework: true, ...(dateOnly(targetDate) ? { target_date: targetDate } : {}) } : {}),
        confirmed_daily_limits: await this.dailyLimits(session), planning_action: action, context: structuredClone(session.context), conversation: history, message, source_message_id: messageId,
        previous_draft: prior ? prior.proposal.tasks : undefined, snapshot: await this.snapshot(session, session.goalId) },
      usage: {}, createdAt: now, updatedAt: now });
    const saved = await this.save({ ...session, status: "generating", activeRunId: run.id, lastError: undefined });
    return { session: saved, run };
  }
  private async generationCalendar(session: PlanningSession, timezone: string): Promise<PlanningCalendarForGeneration | undefined> {
    const start = Date.parse(String(session.context.period_start!.value));
    const end = Date.parse(String(session.context.period_end!.value));
    const dates: string[] = [];
    for (let day = start; day <= end; day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10));
    const rest = await readPlannedRestDates(this.repository, session, dates);
    const unavailable = await readUnavailablePlanningDates(this.repository, session, dates);
    if (!rest.length && !unavailable.length) return undefined;
    const blocked = new Set([...rest, ...unavailable]);
    const allowed_dates = dates.filter(date => !blocked.has(date));
    if (!allowed_dates.length) {
      const code = rest.length === dates.length ? "LIGHTTICK_PLANNED_REST_CONFLICT" : "LIGHTTICK_UNAVAILABLE_PLANNING_DAY";
      planningError(422, code, "Choose a different period or review your planning calendar before generating a draft.");
    }
    return { allowed_dates, timezone };
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
      draft.proposal.stage_id !== session.stageId || subjectIdForPlan(draft) !== session.subjectId)
      planningError(409, "LIGHTTICK_PLANNING_STALE", "Draft ownership no longer matches.");
    await this.checkFollowUp(session);
    if (session.stageId) this.selectRoadmapStage(goal!, session.stageId, draft!.periodStart, draft!.periodEnd);
    else assertGoalDeadlinePlacement(goal!, draft!.periodEnd.slice(0, 10));
    if (session.subjectId) this.selectSubject(goal!, session.subjectId);
    const tasks = (draft!.proposal.tasks as any[]).map(task => ({
      title: task.title, estimated_minutes: task.estimatedMinutes, scheduled_for: task.scheduledFor,
      completion_criteria: task.completionCriteria, steps: task.steps, guidance: task.guidance,
    }));
    validatePlanOutput({ tasks }, {
      availableMinutes: Number(session.context.available_minutes!.value),
      periodStart: draft!.periodStart.slice(0, 10), periodEnd: draft!.periodEnd.slice(0, 10),
      timezone: (await this.repository.getProfile(session))?.timezone ?? "UTC",
      ...savedActionBriefConstraints(draft!, session.context),
    });
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

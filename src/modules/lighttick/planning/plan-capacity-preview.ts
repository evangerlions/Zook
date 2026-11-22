import { ApplicationError } from "../../../shared/errors.ts";
import { validatePlanOutput } from "../ai/lighttick-ai-validation.ts";
import type { ProposedTaskInput } from "../lighttick-plan.service.ts";
import { todayDateAt } from "../lighttick-today.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow } from "../lighttick.types.ts";
import { reviewManualContinuation } from "../manual/manual-continuation.ts";
import { resolveManualPlanSubject } from "../manual/manual-plan-subjects.ts";
import { dateOnly, invalid, validateManualDraft, type ManualDraft } from "../manual/manual-planning.types.ts";
import { assertSubjectPlacement, subjectIdForPlan } from "./goal-subjects.ts";
import { LightTickPlanningService } from "./planning.service.ts";
import { assertRoadmapPlacement } from "./roadmap-placement.ts";
import { previewWeeklyPlanningCapacity } from "./weekly-capacity.ts";

function unavailable(): never {
  throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "A plan eligible for capacity preview was not found.");
}

function stale(message = "The plan changed. Review the current draft."): never {
  throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", message);
}

function checkPeriod(goal: LightTickGoalRow, start: string, end: string, stageId?: string | null) {
  const deadline = goal.targetDate?.slice(0, 10);
  if (!dateOnly(start) || !dateOnly(end) || start > end) invalid("Review the plan dates.");
  if (stageId) assertRoadmapPlacement(goal, stageId, start, end);
  else if (dateOnly(deadline) && end > deadline) invalid("The plan period must fit the goal's deadline.");
}

async function manualCapacity(repository: LightTickRepository, owner: LightTickOwner, plan: LightTickPlanRow,
  goal: LightTickGoalRow, timezone: string, now: Date) {
  const draft = validateManualDraft(plan.proposal.draft as ManualDraft);
  if ((draft.goal_id !== undefined && draft.goal_id !== goal.id) ||
    draft.period_start !== plan.periodStart.slice(0, 10) || draft.period_end !== plan.periodEnd.slice(0, 10)) stale();
  if (!["draft", "active"].includes(goal.status) && !(draft.resume_goal && ["paused", "recovering"].includes(goal.status)))
    throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "This goal is paused or ended.");
  checkPeriod(goal, draft.period_start, draft.period_end, draft.stage_id);
  const existing = await repository.listTasks(owner);
  const { replacements } = await reviewManualContinuation(repository, owner, goal, draft, existing, timezone, plan.id);
  const fromAdvice = typeof plan.proposal.next_week_advice_run_id === "string";
  const scoped = await resolveManualPlanSubject(repository, goal, draft, replacements, !fromAdvice);
  if (scoped.subject_id !== draft.subject_id) stale("The subject of the reviewed work changed.");
  if (fromAdvice) {
    const sources = draft.tasks.flatMap(action => action.source_task_id ? [action.source_task_id] : []);
    const sourceIds = new Set(sources);
    if (sourceIds.size !== sources.length || sourceIds.size !== replacements.length ||
        replacements.some(task => task.lessonSource || !task.executionProgress?.outcome || !sourceIds.has(task.id)))
      invalid("Every transferred action must have one reviewed ordinary task with saved progress.");
  }
  return previewWeeklyPlanningCapacity(repository, owner, draft.tasks.map(action => ({
    scheduledFor: action.scheduled_for ?? undefined, estimatedMinutes: action.estimated_minutes,
    goalId: goal.id, ...(draft.subject_id ? { subjectId: draft.subject_id } : {}), sourceTaskId: action.source_task_id,
  })), {
    existing, replacing: new Set(replacements.map(task => task.id)), timezone, now,
    ...(draft.resume_goal ? { resumingGoalId: goal.id } : {}),
  });
}

async function sessionCapacity(repository: LightTickRepository, owner: LightTickOwner, plan: LightTickPlanRow,
  goal: LightTickGoalRow, sessionId: string, timezone: string, now: Date) {
  const session = await repository.getPlanningSession(owner, sessionId);
  if (!session || session.status !== "draft_ready" || session.activeRunId || session.draftPlanId !== plan.id ||
      session.draftRevision !== session.contextRevision || !session.draftExpiresAt || session.draftExpiresAt <= now.toISOString() ||
      session.goalId !== goal.id || session.stageId !== plan.proposal.stage_id || session.subjectId !== subjectIdForPlan(plan))
    throw new ApplicationError(409, "LIGHTTICK_PLANNING_STALE", "The planning session needs a current, unexpired draft.");
  if (await new LightTickPlanningService(repository).snapshot(owner, goal.id) !== session.baseSnapshot)
    stale("The goal or active plan changed; generate a refreshed draft.");
  if (!["active", "draft"].includes(goal.status))
    throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "The goal cannot accept a plan in its current state.");
  const start = plan.periodStart.slice(0, 10), end = plan.periodEnd.slice(0, 10);
  if (session.context.period_start?.value !== start || session.context.period_end?.value !== end) stale();
  checkPeriod(goal, start, end, session.stageId);
  if (session.subjectId) assertSubjectPlacement(goal, session.subjectId);
  const inputs = Array.isArray(plan.proposal.tasks) ? plan.proposal.tasks as ProposedTaskInput[] : [];
  const { tasks } = validatePlanOutput({ tasks: inputs.map(task => ({
    title: task?.title, estimated_minutes: task?.estimatedMinutes, scheduled_for: task?.scheduledFor,
    completion_criteria: task?.completionCriteria, steps: task?.steps, guidance: task?.guidance,
  })) }, { availableMinutes: Number(session.context.available_minutes?.value), periodStart: start, periodEnd: end, timezone });
  return previewWeeklyPlanningCapacity(repository, owner, tasks.map(action => ({
    scheduledFor: action.scheduled_for, estimatedMinutes: action.estimated_minutes,
    goalId: goal.id, ...(session.subjectId ? { subjectId: session.subjectId } : {}),
  })), { timezone, now, requireScheduledDate: true });
}

export async function readPlanCapacityPreview(repository: LightTickRepository, owner: LightTickOwner, now: Date,
  planId: string | undefined, rawVersion: string | undefined) {
  const version = Number(rawVersion);
  if (!planId || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(planId) ||
      !rawVersion || !/^[1-9][0-9]*$/.test(rawVersion) || !Number.isSafeInteger(version))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a saved plan and its current version.");
  return repository.transaction(owner, async () => {
    await repository.lockPlanningOwner(owner);
    const plan = await repository.getPlan(owner, planId);
    if (!plan) unavailable();
    const manual = plan.source === "manual_native" && plan.proposal.manual_schema === 1;
    const sessionId = plan.source === "ai" && typeof plan.proposal.planning_session_id === "string" ? plan.proposal.planning_session_id : undefined;
    if (!manual && !sessionId) unavailable();
    if (plan.status !== "proposed" || plan.version !== version) stale();
    const goal = await repository.getGoal(owner, plan.goalId);
    if (!goal) unavailable();
    const { timezone } = todayDateAt(now, (await repository.getProfile(owner))?.timezone ?? "UTC");
    const preview = sessionId
      ? await sessionCapacity(repository, owner, plan, goal, sessionId, timezone, now)
      : await manualCapacity(repository, owner, plan, goal, timezone, now);
    return { plan_id: plan.id, plan_version: plan.version, ...preview };
  });
}

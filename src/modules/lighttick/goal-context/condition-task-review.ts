import { ApplicationError } from "../../../shared/errors.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { canReadNativeLearning } from "../learning/native-learning-access.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "../lighttick.types.ts";
import { taskScheduledDate, todayDateAt } from "../lighttick-today.service.ts";
import { taskAwaitingExternalInput, taskExecutionProgressData, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
import { canonical, manualTaskData, ManualPlanningService } from "../manual/manual-planning.service.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { findGoalRoadmapStage, stageIdForPlan } from "../planning/goal-roadmap.ts";
import { findGoalSubject, subjectIdForPlan } from "../planning/goal-subjects.ts";
import { assertOrdinaryTaskDateRange } from "../planning/roadmap-placement.ts";
import { previewWeeklyPlanningCapacity } from "../planning/weekly-capacity.ts";
import { assertDailyCapacity, conditionRevision, conditionsValue } from "./confirmed-conditions.ts";
import { saveReviewedGoalCondition } from "./goal-conditions.service.ts";

interface Move { task_id: string; base_version: number; target_date: string; }

function invalid(message: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", message);
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function reviewInput(raw: Record<string, unknown>, applying = false) {
  const { period_start, period_end, condition, moves, preview_revision } = raw;
  const keys = ["period_start", "period_end", "condition", "moves", ...(applying ? ["preview_revision"] : [])];
  if (Object.keys(raw).some(key => !keys.includes(key)) || !dateOnly(period_start) || !dateOnly(period_end) ||
    period_start.startsWith("0000") || period_end < period_start || Date.parse(period_end) - Date.parse(period_start) > 30 * 86_400_000 ||
    (condition !== null && !objectOf(condition)) || !Array.isArray(moves) || moves.length > 50 ||
    (applying && (typeof preview_revision !== "string" || !/^[a-f0-9]{64}$/.test(preview_revision))))
    invalid("Review an explicit condition and up to 50 moves in a calendar window of at most 31 days.");
  const edits: Move[] = moves.map(item => {
    const move = objectOf(item);
    if (!move || Object.keys(move).length !== 3 || typeof move.task_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(move.task_id) ||
      typeof move.base_version !== "number" || !Number.isSafeInteger(move.base_version) || move.base_version < 1 ||
      !dateOnly(move.target_date) || move.target_date < period_start || move.target_date > period_end)
      invalid("Choose each task, its version and a date inside the reviewed window.");
    return { task_id: move.task_id, base_version: move.base_version, target_date: move.target_date };
  }).sort((a, b) => a.task_id.localeCompare(b.task_id));
  if (new Set(edits.map(move => move.task_id)).size !== edits.length) invalid("Choose each action only once.");
  return { period_start, period_end, condition: condition as Record<string, unknown> | null, moves: edits };
}

function editableDate(task: LightTickTaskRow, plan: LightTickPlanRow, goal: LightTickGoalRow, date: string, today: string) {
  return goal.status === "active" && task.status === "pending" && !task.startedAt && !task.lessonSource &&
    plan.status === "active" && plan.source !== "learning_schedule" && plan.source !== "deterministic_template" &&
    !taskAwaitingExternalInput(task) && !taskHasTransferredRemainingWork(task) &&
    !(task.executionProgress && taskRemainingEstimate(task) === undefined) && date >= today &&
    !(goal.constraints.growth_practice === "work_report" && task.title === "60 秒工作汇报练习");
}

function assertMovePlacement(goal: LightTickGoalRow, plan: LightTickPlanRow, date: string, today: string) {
  if (date < today || date < plan.periodStart.slice(0, 10) || date > plan.periodEnd.slice(0, 10))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Choose a date from today within the existing confirmed plan.");
  assertOrdinaryTaskDateRange(goal, plan, date);
}

async function inspectReview(repository: LightTickRepository, owner: LightTickOwner, goalId: string,
  input: ReturnType<typeof reviewInput>, now: Date) {
  const goal = await repository.getGoal(owner, goalId);
  if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
  if (!["draft", "active", "recovering", "paused"].includes(goal.status) || (goal.status === "paused" && input.moves.length))
    throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Review work on an available goal.");
  const profile = await repository.getProfile(owner);
  const plans = await repository.listPlans(owner, goalId);
  const allTasks = await repository.listTasks(owner);
  const canReadLessons = allTasks.some(task => task.goalId === goalId && task.lessonSource) &&
    canReadNativeLearning(await repository.getLearningAuthority(owner));
  const { timezone, businessDate: business_date } = todayDateAt(now, profile?.timezone ?? "UTC");
  const { period_start, period_end } = input;
  if (input.moves.length && period_end < business_date) invalid("Choose a reviewed window that includes upcoming days.");
  const condition = input.condition ? conditionRevision(goal, input.condition, now.toISOString()) : null;
  const projectedGoal = condition ? { ...goal, constraints: {
    ...goal.constraints, confirmed_planning_conditions: conditionsValue(goal, condition),
  } } : goal;
  const planById = new Map(plans.map(plan => [plan.id, plan]));
  const candidates = allTasks.flatMap(task => {
    const plan = planById.get(task.planId);
    if (task.goalId !== goalId || !plan || ((task.lessonSource || plan.source === "learning_schedule") && !canReadLessons) ||
      !(plan.status === "active" && ["pending", "in_progress", "completed"].includes(task.status) ||
        plan.status === "superseded" && task.status === "completed")) return [];
    const from_date = taskScheduledDate(task, timezone);
    if (!from_date || from_date < period_start || from_date > period_end) return [];
    const stageId = stageIdForPlan(plan), subjectId = subjectIdForPlan(plan);
    const stage = stageId ? findGoalRoadmapStage(goal, stageId) : undefined;
    const stage_title = stage?.title;
    const subject_title = subjectId ? findGoalSubject(goal, subjectId)?.title : undefined;
    const estimated_minutes = task.status === "completed" ? task.actualMinutes ?? task.estimatedMinutes : taskRemainingEstimate(task) ?? null;
    const stageOpen = !stageId || (!!stage && stage.outcome?.state !== "achieved" && (!stage.ends_on || stage.ends_on >= business_date));
    const editable = stageOpen && plan.periodEnd.slice(0, 10) >= business_date &&
      (!goal.targetDate || goal.targetDate.slice(0, 10) >= business_date) && editableDate(task, plan, goal, from_date, business_date);
    return [{ task, plan, item: { task_id: task.id, title: task.title, version: task.version, from_date, to_date: from_date,
      estimated_minutes, editable,
      ...(stage_title ? { stage_title } : {}), ...(subject_title ? { subject_title } : {}) } }];
  }).sort((a, b) => a.item.from_date.localeCompare(b.item.from_date) || a.task.id.localeCompare(b.task.id));
  const byId = new Map(candidates.map(row => [row.task.id, row]));
  const changed = input.moves.flatMap(move => {
    const row = byId.get(move.task_id);
    if (!row || !row.item.editable)
      throw new ApplicationError(409, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Review an editable upcoming action from this goal and window.");
    if (row.task.version !== move.base_version)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "An action changed after review.");
    assertMovePlacement(goal, row.plan, move.target_date, business_date);
    row.item.to_date = move.target_date;
    return row.item.to_date === row.item.from_date ? [] : [row];
  });
  const replacing = new Set(changed.map(row => row.task.id));
  const additions = changed.map(({ task, item }) => ({
    id: task.id, goalId, planId: task.planId, scheduledFor: item.to_date, estimatedMinutes: item.estimated_minutes,
  }));
  const retained = allTasks.filter(task => {
    const plan = planById.get(task.planId);
    return task.goalId === goalId && plan?.goalId === goalId &&
      (plan.status === "active" || plan.status === "superseded" && task.status === "completed");
  });
  const before = assertDailyCapacity(goal, period_start, period_end, [], retained, new Set(), timezone, false);
  const after = assertDailyCapacity(projectedGoal, period_start, period_end, additions.map(action => ({
    scheduled_for: action.scheduledFor, estimated_minutes: action.estimatedMinutes,
  })), retained, replacing, timezone, false);
  const completed = assertDailyCapacity(projectedGoal, period_start, period_end, [],
    retained.filter(task => task.status === "completed"), new Set(), timezone, false);
  let dailyOverLimit = false, dailyMissingEstimate = false;
  const days = after.map((next, index) => {
    const limit = next.date >= business_date && goal.status !== "paused" ? next.minutes : null;
    const overLimit = limit !== null && next.known_minutes > Math.max(limit, completed[index].known_minutes);
    const needsEstimate = limit !== null && next.unknown_count > completed[index].unknown_count;
    dailyOverLimit ||= overLimit;
    dailyMissingEstimate ||= needsEstimate;
    return { date: next.date, before_minutes: before[index].minutes, after_minutes: next.minutes,
      before_load: before[index].known_minutes, after_load: next.known_minutes,
      before_unknown: before[index].unknown_count, after_unknown: next.unknown_count, blocking: overLimit || needsEstimate };
  });
  const weekly = await previewWeeklyPlanningCapacity(repository, owner, additions, { existing: allTasks, replacing, timezone, now });
  const block_reason = weekly.block_reason === "planned_rest" || weekly.block_reason === "unavailable_days" ? weekly.block_reason :
    dailyOverLimit ? "daily_over_limit" : dailyMissingEstimate ? "missing_estimate" :
      weekly.block_reason ?? (!condition && !changed.length ? "no_changes" : null);
  const projection = { goal_id: goalId, goal_version: goal.version, business_date, timezone, period_start, period_end,
    can_apply: block_reason === null, block_reason, days, tasks: candidates.map(row => row.item),
    ...(weekly.weeks.length ? { weeks: weekly.weeks } : {}) };
  const preview_revision = sha256(canonical({ owner, input, projection,
    calendar: { planned_rest_dates: weekly.planned_rest_dates, unavailable_dates: weekly.unavailable_dates } }));
  return { goal, condition, changed, preview: { ...projection, preview_revision } };
}

export async function previewConditionTaskReview(repository: LightTickRepository, owner: LightTickOwner, goalId: string, clock: () => Date,
  raw: Record<string, unknown>) {
  const input = reviewInput(raw);
  return repository.transaction(owner, async () => {
    await repository.lockPlanningOwner(owner);
    return (await inspectReview(repository, owner, goalId, input, clock())).preview;
  });
}

export async function applyConditionTaskReview(repository: LightTickRepository, owner: LightTickOwner, goalId: string, clock: () => Date,
  key: string, raw: Record<string, unknown>, assertActive: () => Promise<void>) {
  const input = reviewInput(raw, true);
  return new ManualPlanningService(repository, clock, assertActive).operation(owner, key, "condition-task-review:" + goalId, raw, async () => {
    const now = clock();
    const { goal, condition, changed, preview } = await inspectReview(repository, owner, goalId, input, now);
    if (raw.preview_revision !== preview.preview_revision)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The reviewed arrangements changed. Preview again.");
    if (!preview.can_apply)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Review the outstanding scheduling conflicts.", { block_reason: preview.block_reason });
    const timestamp = now.toISOString();
    const saved = condition ? await saveReviewedGoalCondition(repository, owner, goal, condition, timestamp) : goal;
    const moved_tasks = [];
    for (const { task, item } of changed) {
      const version = task.version + 1;
      const moved = await repository.saveTask({ ...task, scheduledFor: item.to_date, updatedAt: timestamp }, {
        event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: task.id,
          eventType: "task_reschedule", aggregateVersion: version,
          payload: { action: "reschedule", source: "condition_review", previous_scheduled_for: task.scheduledFor, scheduled_for: item.to_date },
          occurredAt: timestamp, createdAt: timestamp },
        change: { ...owner, entityType: "task", entityId: task.id, entityVersion: version, operation: "upsert",
          snapshot: { id: task.id, version, status: task.status, scheduled_for: item.to_date,
            ...(task.executionProgress ? { execution_progress: taskExecutionProgressData(task.executionProgress) ?? null } : {}) },
          changedAt: timestamp },
      }, task.version);
      moved_tasks.push(manualTaskData(moved, preview.timezone));
    }
    return { goal: saved, condition, moved_tasks };
  });
}

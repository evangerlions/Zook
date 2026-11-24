import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { canReadNativeLearning } from "../learning/native-learning-access.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { businessDateAt, todayDateAt } from "../lighttick-today.service.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { findGoalRoadmapStage, stageIdForPlan } from "./goal-roadmap.ts";
import { stageOutcomeStatuses, type StageOutcomeEvidenceHistory, type StageOutcomeEvidenceRow,
  type StageOutcomeEvidenceWindow, type StageOutcomeValue } from "./stage-outcome-evidence-store.ts";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const stageIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
type TaskChoice = { task_id: string; title: string; completed_on: string };

function invalid(message: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", message);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value.trim() || undefined : undefined;
}

function validDate(value: unknown): value is string {
  return dateOnly(value) && !value.startsWith("0000");
}

function normalizeValue(kind: unknown, value: unknown): StageOutcomeValue {
  const fields = record(value);
  if (kind === "text" && fields && Object.keys(fields).length === 1) {
    const result = text(fields.value, 2000);
    if (result) return { kind, value: { value: result } };
  }
  if (kind === "number" && fields && typeof fields.value === "number" && Number.isFinite(fields.value) &&
    Object.keys(fields).every(key => ["value", "unit", "comparable_condition"].includes(key))) {
    const unit = text(fields.unit, 80), condition = text(fields.comparable_condition, 400);
    if (unit && (fields.comparable_condition === undefined || condition))
      return { kind, value: { value: fields.value, unit, ...(condition ? { comparable_condition: condition } : {}) } };
  }
  if (kind === "status" && fields && Object.keys(fields).length === 1) {
    const status = stageOutcomeStatuses.find(option => option === fields.value);
    if (status) return { kind, value: { value: status } };
  }
  return invalid("Provide one valid outcome value and an explicit unit for a numeric measurement.");
}

function normalizeWrite(input: Record<string, unknown>) {
  const { stage_id, occurred_on, metric, task_id, corrects } = input;
  if (Object.keys(input).some(key => !["stage_id", "occurred_on", "metric", "kind", "value", "task_id", "corrects"].includes(key)) ||
    typeof stage_id !== "string" || !stageIdPattern.test(stage_id) || !validDate(occurred_on) ||
    (task_id != null && (typeof task_id !== "string" || !idPattern.test(task_id))))
    invalid("Review the stage, date and source action.");
  const label = text(metric, 160);
  if (!label) invalid("Name the result or measurement.");
  const prior = record(corrects);
  if (corrects !== undefined && (!prior || Object.keys(prior).length !== 2 || typeof prior.id !== "string" ||
    !idPattern.test(prior.id) || typeof prior.version !== "number" || !Number.isSafeInteger(prior.version) || prior.version < 1))
    invalid("Choose the original evidence and its version.");
  return { stageId: stage_id, occurredOn: occurred_on, metric: label, taskId: task_id as string | null | undefined,
    corrects: prior as { id: string; version: number } | undefined, ...normalizeValue(input.kind, input.value) };
}

function goalStage(goal: LightTickGoalRow | undefined, stageId?: string) {
  if (!goal || (stageId && !findGoalRoadmapStage(goal, stageId)))
    throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "The goal or stage was not found.");
  return goal;
}

function choiceOf(task: LightTickTaskRow, timezone: string, canReadLearning: boolean): TaskChoice | undefined {
  const instant = new Date(task.completedAt ?? "");
  if (task.status !== "completed" || !Number.isFinite(+instant) || (task.lessonSource && !canReadLearning)) return;
  return { task_id: task.id, title: task.title, completed_on: businessDateAt(instant, timezone) };
}

function matchesStage(plan: LightTickPlanRow | undefined, goalId: string, stageId: string) {
  return plan?.goalId === goalId && ["active", "superseded"].includes(plan.status) && stageIdForPlan(plan) === stageId;
}

async function selectedTask(repository: LightTickRepository, owner: LightTickOwner, goalId: string, stageId: string, taskId: string, timezone: string) {
  const task = await repository.getTask(owner, taskId);
  if (task?.goalId === goalId && matchesStage(await repository.getPlan(owner, task.planId), goalId, stageId)) {
    const choice = choiceOf(task, timezone, !task.lessonSource || canReadNativeLearning(await repository.getLearningAuthority(owner)));
    if (choice) return { taskId: choice.task_id, taskTitle: choice.title };
  }
  throw new ApplicationError(422, "LIGHTTICK_OUTCOME_SOURCE_INVALID", "Choose a completed action from this stage.");
}

async function taskChoices(repository: LightTickRepository, owner: LightTickOwner, goalId: string, stageId: string, timezone: string,
  { startsOn, endsOn }: StageOutcomeEvidenceWindow) {
  const plans = (await repository.listPlans(owner, goalId)).filter(plan => matchesStage(plan, goalId, stageId));
  if (!plans.length) return [];
  const canReadLearning = canReadNativeLearning(await repository.getLearningAuthority(owner));
  const tasks = (await Promise.all(plans.map(plan => repository.listTasks(owner, plan.id)))).flat();
  return tasks.filter(task => task.goalId === goalId).flatMap(task => {
    const choice = choiceOf(task, timezone, canReadLearning);
    return choice && (!startsOn || choice.completed_on >= startsOn) && (!endsOn || choice.completed_on <= endsOn) ? [choice] : [];
  }).sort((left, right) => right.completed_on.localeCompare(left.completed_on) || left.task_id.localeCompare(right.task_id));
}

function evidenceData(row: StageOutcomeEvidenceHistory) {
  return {
    id: row.id, goal_id: row.goalId, stage_id: row.stageId, version: row.version,
    occurred_on: row.occurredOn, recorded_at: row.recordedAt, metric: row.metric, kind: row.kind, value: row.value,
    ...(row.taskId ? { task_id: row.taskId, task_title: row.taskTitle } : {}),
    ...(row.correctedFrom ? { corrected_from: row.correctedFrom } : {}),
    is_current: row.isCurrent,
  };
}

export async function readStageOutcomeEvidence(repository: LightTickRepository, owner: LightTickOwner, goalId: string, now: Date,
  { stage_id: stageId, starts_on: startsOn, ends_on: endsOn, include_task_choices: include }: Record<string, string | undefined>) {
  if ((stageId !== undefined && !stageIdPattern.test(stageId)) || (startsOn !== undefined && !validDate(startsOn)) ||
    (endsOn !== undefined && !validDate(endsOn)) || (startsOn && endsOn && startsOn > endsOn) ||
    (include !== undefined && include !== "true" && include !== "false"))
    invalid("Choose a valid stage and calendar window.");
  return repository.transaction(owner, async () => {
    goalStage(await repository.getGoal(owner, goalId), stageId);
    const { timezone } = todayDateAt(now, (await repository.getProfile(owner))?.timezone ?? "UTC");
    const window = { stageId, startsOn, endsOn };
    const items = (await repository.stageOutcomeEvidence.list(owner, goalId, window)).map(evidenceData);
    const task_choices = stageId && include === "true" ? await taskChoices(repository, owner, goalId, stageId, timezone, window) : undefined;
    return { timezone, items, ...(task_choices ? { task_choices } : {}) };
  });
}

/** Called from the owner-locked HTTP write that also stores the original retry receipt. */
export async function saveStageOutcomeEvidence(repository: LightTickRepository, owner: LightTickOwner, goalId: string, now: Date,
  body: Record<string, unknown>) {
  const { taskId, corrects, ...fields } = normalizeWrite(body);
  const goal = goalStage(await repository.getGoal(owner, goalId), fields.stageId);
  if (!["draft", "active", "recovering"].includes(goal.status))
    throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Evidence for paused or ended goals is read-only.");
  const { timezone, businessDate } = todayDateAt(now, (await repository.getProfile(owner))?.timezone ?? "UTC");
  if (fields.occurredOn > businessDate) invalid("Outcome dates cannot be in the future.");
  let prior: StageOutcomeEvidenceHistory | undefined;
  if (corrects) {
    prior = await repository.stageOutcomeEvidence.get(owner, goalId, fields.stageId, corrects.id);
    if (!prior?.isCurrent || prior.version !== corrects.version)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Review the current evidence before correcting it.");
  }
  const attribution = taskId ? await selectedTask(repository, owner, goalId, fields.stageId, taskId, timezone)
    : taskId === undefined && prior?.taskId ? { taskId: prior.taskId, taskTitle: prior.taskTitle } : {};
  const row: StageOutcomeEvidenceRow = {
    ...owner, ...fields, ...attribution, id: randomId("lighttick_outcome"), goalId, recordedAt: now.toISOString(),
    version: (prior?.version ?? 0) + 1, ...(prior ? { correctedFrom: prior.id } : {}),
  };
  await repository.stageOutcomeEvidence.add(row);
  return { evidence: evidenceData({ ...row, isCurrent: true }) };
}

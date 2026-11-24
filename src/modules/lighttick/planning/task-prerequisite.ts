import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "../lighttick.types.ts";
import { taskScheduledDate } from "../lighttick-today.service.ts";

export interface TaskPrerequisite {
  task_id: string;
  title: string | null;
  state: "waiting" | "complete" | "unavailable";
}

const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const sourceStatuses = new Set(["pending", "in_progress", "completed"]);

function ordinaryTask(task: LightTickTaskRow, plan: LightTickPlanRow | undefined, goal: LightTickGoalRow | undefined) {
  return !task.lessonSource && plan?.goalId === task.goalId && goal?.id === task.goalId &&
    plan.source !== "learning_schedule" && plan.source !== "deterministic_template" &&
    !plan.proposal.progressive_stage && goal.constraints.growth_practice !== "work_report";
}

export function taskPrerequisiteOf(task: LightTickTaskRow, source?: LightTickTaskRow): TaskPrerequisite | null {
  const task_id = task.prerequisiteTaskId;
  if (!task_id) return null;
  // An internal plan revision can move the target. A trusted edge continues to refer to the same source ID.
  if (!source || source.id !== task_id || source.appId !== task.appId || source.userId !== task.userId ||
    source.goalId !== task.goalId || source.lessonSource)
    return { task_id, title: null, state: "unavailable" };
  const state = source.status === "completed" ? "complete" : sourceStatuses.has(source.status) ? "waiting" : "unavailable";
  return { task_id, title: source.title, state };
}

export async function readTaskPrerequisite(repository: LightTickRepository, owner: LightTickOwner, task: LightTickTaskRow) {
  return taskPrerequisiteOf(task, task.prerequisiteTaskId ? await repository.getTask(owner, task.prerequisiteTaskId) : undefined);
}

export function assertSatisfiedPrerequisite(prerequisite: TaskPrerequisite | null): void {
  if (prerequisite && prerequisite.state !== "complete")
    throw new ApplicationError(409, "LIGHTTICK_TASK_PREREQUISITE_BLOCKED",
      "Complete the prerequisite or review this task’s prerequisite choice.", { task_prerequisite: prerequisite });
}

export async function assertTaskPrerequisiteSatisfied(repository: LightTickRepository, owner: LightTickOwner, task: LightTickTaskRow) {
  assertSatisfiedPrerequisite(await readTaskPrerequisite(repository, owner, task));
}

function unavailable() {
  return new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
}

async function readScope(repository: LightTickRepository, owner: LightTickOwner, id: string) {
  const task = await repository.getTask(owner, id);
  if (!task) throw unavailable();
  const [plan, goal] = await Promise.all([repository.getPlan(owner, task.planId), repository.getGoal(owner, task.goalId)]);
  if (!ordinaryTask(task, plan, goal)) throw unavailable();
  const hasExecution = task.status !== "pending" || !!task.startedAt || !!task.completedAt || task.actualMinutes != null ||
    !!task.executionProgress?.outcome || !!task.executionProgress?.remainingWork ||
    !!task.executionProgress?.transferredToTaskId;
  const editable = !hasExecution && plan?.status === "active" && goal?.status === "active" &&
    !(await repository.listTaskSteps(owner, id)).some(step => step.completed);
  return { task, editable: Boolean(editable), plan, goal };
}

function createsCycle(targetId: string, candidate: LightTickTaskRow, tasks: Map<string, LightTickTaskRow>): boolean {
  const visited = new Set([targetId]);
  let current: LightTickTaskRow | undefined = candidate;
  while (current) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    current = current.prerequisiteTaskId ? tasks.get(current.prerequisiteTaskId) : undefined;
  }
  return false;
}

async function readReceipt(repository: LightTickRepository, owner: LightTickOwner, scope: Awaited<ReturnType<typeof readScope>>) {
  const { task, editable, plan, goal } = scope;
  const prerequisite = await readTaskPrerequisite(repository, owner, task);
  let choices: { task_id: string; title: string; scheduled_date: string | null }[] = [];
  if (editable) {
    const timezone = (await repository.getProfile(owner))?.timezone ?? "UTC";
    const planTasks = await repository.listTasks(owner, task.planId);
    const tasks = new Map(planTasks.map(row => [row.id, row]));
    // A previous plan may still hold the original source. Only read referenced rows for this goal.
    const pending = planTasks.flatMap(row => row.prerequisiteTaskId ? [row.prerequisiteTaskId] : []);
    const inspected = new Set(tasks.keys());
    for (const sourceId of pending) {
      if (inspected.has(sourceId)) continue;
      inspected.add(sourceId);
      const source = await repository.getTask(owner, sourceId);
      if (!source || source.goalId !== task.goalId || source.lessonSource) continue;
      tasks.set(sourceId, source);
      if (source.prerequisiteTaskId) pending.push(source.prerequisiteTaskId);
    }
    choices = planTasks.filter(candidate => candidate.planId === task.planId && ordinaryTask(candidate, plan, goal) &&
      sourceStatuses.has(candidate.status) && !createsCycle(task.id, candidate, tasks))
      .map(candidate => ({ task_id: candidate.id, title: candidate.title, scheduled_date: taskScheduledDate(candidate, timezone) ?? null }))
      .sort((a, b) => (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "") || a.task_id.localeCompare(b.task_id));
  }
  return { task_id: task.id, task_version: task.version, editable, prerequisite, choices };
}

export async function getTaskPrerequisite(repository: LightTickRepository, owner: LightTickOwner, id: string) {
  return repository.transaction(owner, async () => readReceipt(repository, owner, await readScope(repository, owner, id)));
}

/** Execute from the owner-locked write that also records the HTTP retry receipt. */
export async function setTaskPrerequisite(repository: LightTickRepository, owner: LightTickOwner, id: string,
  input: Record<string, unknown>, now: Date) {
  const { base_version: version, prerequisite_task_id: sourceId } = input;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 ||
    (sourceId !== null && (typeof sourceId !== "string" || !taskIdPattern.test(sourceId))) ||
    Object.keys(input).some(key => key !== "base_version" && key !== "prerequisite_task_id"))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Review the prerequisite choice and task version.");
  const scope = await readScope(repository, owner, id);
  const { task, editable } = scope;
  if (version !== task.version) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Task version is stale.");
  if (!editable) throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Prerequisites can be edited before work starts.");
  const receipt = await readReceipt(repository, owner, scope);
  if (sourceId !== null && !receipt.choices.some(choice => choice.task_id === sourceId))
    throw new ApplicationError(422, "LIGHTTICK_TASK_PREREQUISITE_INVALID", "Choose another action in the same plan that does not depend on this one.");
  if ((task.prerequisiteTaskId ?? null) === sourceId) return receipt;
  const timestamp = now.toISOString();
  const saved = await repository.saveTask({ ...task, prerequisiteTaskId: sourceId ?? undefined, updatedAt: timestamp }, {
    event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: id,
      eventType: "task_prerequisite_updated", aggregateVersion: version + 1, payload: { prerequisite_task_id: sourceId },
      occurredAt: timestamp, createdAt: timestamp },
    change: { ...owner, entityType: "task", entityId: id, entityVersion: version + 1, operation: "upsert",
      snapshot: { id, version: version + 1, prerequisite_task_id: sourceId }, changedAt: timestamp },
  }, version);
  return { ...receipt, task_version: saved.version, prerequisite: await readTaskPrerequisite(repository, owner, saved) };
}

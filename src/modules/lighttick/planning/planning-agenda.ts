import { ApplicationError } from "../../../shared/errors.ts";
import { canReadNativeLearning } from "../learning/native-learning-access.ts";
import { isOrdinaryTaskMissingEstimate, taskHasTransferredRemainingWork } from "../lighttick-task-progress.ts";
import { taskScheduledDate, todayDateAt } from "../lighttick-today.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { readUnavailableAgendaDates } from "./planning-availability.ts";
import { planSubjectData } from "./subject-plan-projection.ts";
import { taskPrerequisiteOf } from "./task-prerequisite.ts";

const maxDateSpan = 30 * 86_400_000;
const validGoalId = /^[A-Za-z0-9_-]{1,128}$/;

export function isAgendaTaskVisible(task: LightTickTaskRow, goal: LightTickGoalRow, plan: LightTickPlanRow, includeCompletedHistory: boolean) {
  if (plan.goalId !== goal.id) return false;
  if (task.status === "completed") return plan.status === "active" || (includeCompletedHistory && plan.status === "superseded");
  return plan.status === "active" && ["active", "recovering"].includes(goal.status) &&
    (task.status === "pending" || task.status === "in_progress") && !taskHasTransferredRemainingWork(task);
}

export async function readPlanningAgenda(repository: LightTickRepository, owner: LightTickOwner, now: Date,
  { starts_on: startsOn, ends_on: endsOn, goal_id: goalId, include_completed_history: rawHistory }: {
    starts_on?: string; ends_on?: string; goal_id?: string; include_completed_history?: string;
  }) {
  if (!dateOnly(startsOn) || !dateOnly(endsOn) || startsOn.startsWith("0000") || startsOn > endsOn ||
    Date.parse(endsOn) - Date.parse(startsOn) > maxDateSpan) {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a calendar window of one to 31 days.");
  }
  if (goalId !== undefined && !validGoalId.test(goalId))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a valid goal ID.");
  if (rawHistory !== undefined && rawHistory !== "true" && rawHistory !== "false")
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Completed history must be true or false.");

  return repository.transaction(owner, async () => {
    const requestedGoal = goalId === undefined ? undefined : await repository.getGoal(owner, goalId);
    if (goalId !== undefined && !requestedGoal)
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const { timezone, businessDate } = todayDateAt(now, (await repository.getProfile(owner))?.timezone ?? "UTC");
    const canReadLearning = canReadNativeLearning(await repository.getLearningAuthority(owner));
    const tasks = await repository.listPlanningAgendaTasks(owner, startsOn, endsOn, canReadLearning, goalId);
    const plans = new Map((await repository.listPlans(owner, goalId)).map(plan => [plan.id, plan]));
    const goals = new Map((requestedGoal ? [requestedGoal] : await repository.listGoals(owner)).map(goal => [goal.id, goal]));
    const items = tasks.flatMap(task => {
      const goal = goals.get(task.goalId);
      const plan = plans.get(task.planId);
      if (!goal || !plan || !isAgendaTaskVisible(task, goal, plan, rawHistory === "true")) return [];
      const date = taskScheduledDate(task, timezone);
      if (!date || date < startsOn || date > endsOn) return [];
      const remaining = task.status === "completed" ? undefined : task.executionProgress?.remainingEstimatedMinutes;
      return [{ task, needsEstimate: isOrdinaryTaskMissingEstimate(task, goal, plan), item: {
        id: task.id, goal_id: goal.id, goal_title: goal.title, title: task.title, status: task.status, scheduled_date: date,
        estimated_duration_minutes: task.estimatedMinutes ?? null, actual_duration_minutes: task.actualMinutes ?? null,
        ...(remaining === undefined ? {} : { remaining_estimated_minutes: remaining }),
        ...planSubjectData(plan, goal),
      } }];
    });
    const taskById = new Map(tasks.map(task => [task.id, task]));
    const missingSources = new Set(items.flatMap(({ task }) => task.prerequisiteTaskId && task.status !== "completed" &&
      !taskById.has(task.prerequisiteTaskId) ? [task.prerequisiteTaskId] : []));
    const [rest_dates, unavailable_dates, sources] = await Promise.all([
      repository.plannedRest.list(owner, startsOn, endsOn),
      readUnavailableAgendaDates(repository, owner, businessDate, startsOn, endsOn),
      Promise.all([...missingSources].map(id => repository.getTask(owner, id))),
    ]);
    for (const source of sources) if (source) taskById.set(source.id, source);
    const projected = items.map(({ task, item }) => {
      if (task.status === "completed" || !task.prerequisiteTaskId) return item;
      const prerequisite = taskPrerequisiteOf(task, taskById.get(task.prerequisiteTaskId));
      return { ...item, ...(prerequisite && { task_prerequisite: prerequisite }) };
    }).sort((first, second) => first.scheduled_date.localeCompare(second.scheduled_date) || first.id.localeCompare(second.id));
    const estimate_tasks = items.flatMap(({ task, item, needsEstimate }) => needsEstimate ? [{
      task_id: item.id, title: item.title, scheduled_date: item.scheduled_date,
      version: task.version, editable: item.scheduled_date >= businessDate,
    }] : []).sort((first, second) =>
      first.scheduled_date.localeCompare(second.scheduled_date) || first.task_id.localeCompare(second.task_id));
    return { starts_on: startsOn, ends_on: endsOn, timezone, items: projected,
      ...(estimate_tasks.length ? { estimate_tasks } : {}),
      ...(rest_dates.length ? { rest_dates } : {}), ...(unavailable_dates.length ? { unavailable_dates } : {}) };
  });
}

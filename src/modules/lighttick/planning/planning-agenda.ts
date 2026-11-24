import { ApplicationError } from "../../../shared/errors.ts";
import { canReadNativeLearning } from "../learning/native-learning-access.ts";
import { taskHasTransferredRemainingWork } from "../lighttick-task-progress.ts";
import { taskScheduledDate, todayDateAt } from "../lighttick-today.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { planSubjectData } from "./subject-plan-projection.ts";

const maxDateSpan = 30 * 86_400_000;

export async function readPlanningAgenda(repository: LightTickRepository, owner: LightTickOwner, now: Date,
  startsOn: unknown, endsOn: unknown) {
  if (!dateOnly(startsOn) || !dateOnly(endsOn) || startsOn.startsWith("0000") || startsOn > endsOn ||
    Date.parse(endsOn) - Date.parse(startsOn) > maxDateSpan) {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a calendar window of one to 31 days.");
  }

  return repository.transaction(owner, async () => {
    const { timezone } = todayDateAt(now, (await repository.getProfile(owner))?.timezone ?? "UTC");
    const canReadLearning = canReadNativeLearning(await repository.getLearningAuthority(owner));
    const tasks = await repository.listPlanningAgendaTasks(owner, startsOn, endsOn, canReadLearning);
    const plans = new Map((await repository.listPlans(owner)).filter(plan => plan.status === "active").map(plan => [plan.id, plan]));
    const goals = new Map((await repository.listGoals(owner)).map(goal => [goal.id, goal]));
    const items = tasks.flatMap(task => {
      const goal = goals.get(task.goalId);
      const plan = plans.get(task.planId);
      if (!goal || plan?.goalId !== goal.id) return [];
      const status = task.status;
      if (status !== "completed" && (status !== "pending" && status !== "in_progress" ||
        !["active", "recovering"].includes(goal.status) || taskHasTransferredRemainingWork(task))) return [];
      const date = taskScheduledDate(task, timezone);
      if (!date || date < startsOn || date > endsOn) return [];
      return [{
        id: task.id, goal_id: goal.id, goal_title: goal.title, title: task.title, status, scheduled_date: date,
        estimated_duration_minutes: task.estimatedMinutes ?? null, actual_duration_minutes: task.actualMinutes ?? null,
        ...planSubjectData(plan, goal),
      }];
    }).sort((first, second) => first.scheduled_date.localeCompare(second.scheduled_date) || first.id.localeCompare(second.id));
    return { starts_on: startsOn, ends_on: endsOn, timezone, items };
  });
}

import { ApplicationError } from "../../../shared/errors.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
import { taskScheduledDate } from "../lighttick-today.service.ts";
import type { LightTickGoalRow, LightTickPlanRow, LightTickTaskRow } from "../lighttick.types.ts";
import { conditionHistory, dailyLimitsForDates } from "./confirmed-conditions.ts";

export interface GoalConditionAdjustment {
  goal_id: string;
  goal_title: string;
  task_count: number;
  starts_on: string;
  ends_on: string;
}

interface DayLoad {
  openCount: number;
  openUnknownCount: number;
  knownMinutes: number;
}

export function readConditionAdjustments(goals: LightTickGoalRow[], plans: LightTickPlanRow[], tasks: LightTickTaskRow[],
  businessDate: string, timezone: string): GoalConditionAdjustment[] {
  const relevant = new Map(goals.filter(goal => goal.constraints.confirmed_planning_conditions !== undefined)
    .map(goal => [goal.id, { goal, loads: new Map<string, DayLoad>() }]));
  if (!relevant.size) return [];
  const plansById = new Map(plans.map(plan => [plan.id, plan]));

  for (const task of tasks) {
    const scope = relevant.get(task.goalId);
    const plan = plansById.get(task.planId);
    if (!scope || !plan || plan.goalId !== task.goalId) continue;
    const open = plan.status === "active" && (task.status === "pending" || task.status === "in_progress") &&
      !taskAwaitingExternalInput(task) && !taskHasTransferredRemainingWork(task);
    const completed = (plan.status === "active" || plan.status === "superseded") && task.status === "completed";
    if (!open && !completed) continue;
    const date = taskScheduledDate(task, timezone);
    if (!date || date < businessDate) continue;
    const load = scope.loads.get(date) ?? { openCount: 0, openUnknownCount: 0, knownMinutes: 0 };
    const minutes = open ? taskRemainingEstimate(task) : task.actualMinutes ?? task.estimatedMinutes;
    if (open) {
      load.openCount++;
      if (minutes == null) load.openUnknownCount++;
    }
    load.knownMinutes += minutes ?? 0;
    scope.loads.set(date, load);
  }

  const adjustments: GoalConditionAdjustment[] = [];
  for (const { goal, loads } of relevant.values()) {
    const dates = [...loads.keys()].filter(date => loads.get(date)!.openCount > 0).sort();
    if (!dates.length) continue;
    let history;
    try { history = conditionHistory(goal); }
    catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== "LIGHTTICK_VERSION_CONFLICT") throw error;
      continue;
    }
    const affected = dailyLimitsForDates(history, dates).filter(({ date, minutes }) => {
      const load = loads.get(date)!;
      return minutes !== null && (load.openUnknownCount > 0 || load.knownMinutes > minutes);
    });
    if (!affected.length) continue;
    adjustments.push({ goal_id: goal.id, goal_title: goal.title,
      task_count: affected.reduce((count, day) => count + loads.get(day.date)!.openCount, 0),
      starts_on: affected[0].date, ends_on: affected.at(-1)!.date });
  }
  return adjustments.sort((left, right) => left.starts_on.localeCompare(right.starts_on) || left.goal_id.localeCompare(right.goal_id));
}

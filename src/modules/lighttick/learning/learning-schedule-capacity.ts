import { assertDailyCapacity } from "../goal-context/confirmed-conditions.ts";
import type { LightTickGoalRow, LightTickTaskRow } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { dateOnly, invalid } from "../manual/manual-planning.types.ts";

export interface LearningScheduleBudget {
  available_daily_minutes: number;
  available_weekly_minutes: number;
}
interface Arrangement {
  scheduled_for: string | null;
  estimated_minutes: number | null;
}
const dayMs = 86_400_000;

export function taskBusinessDate(task: LightTickTaskRow, timezone: string) {
  if (!task.scheduledFor) return null;
  return dateOnly(task.scheduledFor) ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone);
}

function weekOf(date: string) {
  const day = new Date(date);
  return new Date(+day - ((day.getUTCDay() + 6) % 7) * dayMs).toISOString().slice(0, 10);
}

export function assertLearningCapacity(
  goal: LightTickGoalRow,
  budget: LearningScheduleBudget,
  arrangements: Arrangement[],
  existing: LightTickTaskRow[],
  timezone: string,
  replacing = new Set<string>(),
) {
  const dates = arrangements.flatMap(item => item.scheduled_for ? [item.scheduled_for] : []).sort();
  if (!dates.length) return;
  assertDailyCapacity(goal, dates[0], dates.at(-1)!, arrangements, existing, replacing, timezone);
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  const touchedDays = new Set(dates);
  const touchedWeeks = new Set(dates.map(weekOf));
  function add(date: string | null, minutes: number | null) {
    if (!date || !touchedWeeks.has(weekOf(date))) return;
    if (minutes === null) invalid("Estimate the existing dated work before confirming this week.");
    perDay.set(date, (perDay.get(date) ?? 0) + minutes);
    const week = weekOf(date);
    perWeek.set(week, (perWeek.get(week) ?? 0) + minutes);
  }
  for (const task of existing) {
    if (task.goalId !== goal.id || replacing.has(task.id) || !["pending", "in_progress", "completed"].includes(task.status)) continue;
    add(taskBusinessDate(task, timezone), task.status === "completed" ? task.actualMinutes ?? task.estimatedMinutes : task.estimatedMinutes);
  }
  for (const item of arrangements) add(item.scheduled_for, item.estimated_minutes);
  const goalWeekly = goal.constraints.weekly_available_minutes;
  const availableWeekly = typeof goalWeekly === "number" && goalWeekly > 0 ?
    Math.min(goalWeekly, budget.available_weekly_minutes) : budget.available_weekly_minutes;
  if ([...touchedDays].some(date => perDay.get(date)! > Math.floor(budget.available_daily_minutes * 0.8)) ||
      [...perWeek.values()].some(minutes => minutes > Math.floor(availableWeekly * 0.8))) {
    invalid("The reviewed arrangements exceed 80% of the available day or week after existing work is counted.");
  }
}

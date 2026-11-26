import { assertDailyCapacity } from "../goal-context/confirmed-conditions.ts";
import type { LightTickGoalRow, LightTickTaskRow } from "../lighttick.types.ts";
import { businessDateAt } from "../lighttick-today.service.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
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
    if (task.status !== "completed" && (taskAwaitingExternalInput(task) || taskHasTransferredRemainingWork(task))) continue;
    add(taskBusinessDate(task, timezone), task.status === "completed" ? task.actualMinutes ?? task.estimatedMinutes : taskRemainingEstimate(task) ?? null);
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

/**
 * 5.2 依赖：课节先后由蓝图 number 决定，草案不得把后面的课排到前面去。
 * 同一课节可能有 learn / practice 两条（同号），按同号最小日期比较；
 * 同日不限（同日先学后练是正常排法），只拒「后来的课被排到更早的日期」。
 */
export function assertLessonOrder(tasks: Array<{ lesson_number: number; scheduled_for: string }>): void {
  const earliest = new Map<number, string>();
  for (const task of tasks) {
    const at = new Date(task.scheduled_for).getTime();
    if (Number.isNaN(at)) continue;
    const current = earliest.get(task.lesson_number);
    if (!current || new Date(current).getTime() > at) earliest.set(task.lesson_number, task.scheduled_for);
  }
  const ordered = [...earliest.entries()].sort((a, b) => a[0] - b[0]);
  for (let index = 1; index < ordered.length; index++) {
    const [previousNumber, previousDate] = ordered[index - 1]!;
    const [number, date] = ordered[index]!;
    if (new Date(date).getTime() < new Date(previousDate).getTime()) {
      invalid(`Lesson ${number} is scheduled before lesson ${previousNumber}; keep the course order when scheduling.`);
    }
  }
}

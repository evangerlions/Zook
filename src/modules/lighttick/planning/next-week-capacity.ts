import { ApplicationError } from "../../../shared/errors.ts";
import { assertDailyCapacity } from "../goal-context/confirmed-conditions.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import { taskScheduledDate } from "../lighttick-today.service.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickTaskRow } from "../lighttick.types.ts";
import { taskRemainingEstimate } from "../lighttick-task-progress.ts";
import { resolveManualPlanSubject } from "../manual/manual-plan-subjects.ts";
import type { ManualDraft } from "../manual/manual-planning.types.ts";
import { assertAvailableCalendarDates, readCalendarConflicts } from "./planning-calendar-admission.ts";
import { assertWeeklyPlanningCapacity, readAdviceWeekOccupancy } from "./weekly-capacity.ts";

type Scope = { limit_minutes: number | null; known_minutes: number; unknown_count: number; remaining_minutes: number | null };
type DateBlock = "past" | "after_deadline" | "planned_rest" | "unavailable_day" | "daily_limit" | "missing_estimate";
type DayAvailability = Scope & { date: string; blocking_reason: DateBlock | null };
type WeekBlock = "missing_estimate" | "weekly_limit" | "no_eligible_dates";

export interface NextWeekAvailability {
  timezone: string;
  starts_on: string;
  ends_on: string;
  can_schedule: boolean;
  blocking_reason: WeekBlock | null;
  account: Scope;
  goal: Scope;
  days: DayAvailability[];
}

interface CarryCredit { id: string; date: string; minutes: number; }
export interface NextWeekCapacitySnapshot {
  availability: NextWeekAvailability;
  account_pending_unknown: number;
  calendar: Awaited<ReturnType<typeof readCalendarConflicts>>;
  carry_credits: CarryCredit[];
}

type CapacityAction = Pick<ManualDraft["tasks"][number], "scheduled_for" | "estimated_minutes" | "source_task_id">;

function finiteGoalLimit(goal: LightTickGoalRow): number | null {
  const value = goal.constraints.weekly_available_minutes;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10080 ? value : null;
}

function scope(limit_minutes: number | null, known_minutes: number, unknown_count: number): Scope {
  return { limit_minutes, known_minutes, unknown_count,
    remaining_minutes: limit_minutes === null || unknown_count ? null : Math.max(0, limit_minutes - known_minutes) };
}

function calendarBlocked(day: DayAvailability): boolean {
  return day.blocking_reason !== null && !["daily_limit", "missing_estimate"].includes(day.blocking_reason);
}

function dailyFits(day: DayAvailability, addition: number, release: number): boolean {
  return (day.limit_minutes === null || !day.unknown_count || addition <= release) &&
    day.known_minutes + addition - release <= Math.min(day.limit_minutes ?? 1440, 1440);
}

function goalFits(goal: Scope, addition: number, release: number): boolean {
  return goal.limit_minutes === null || (!goal.unknown_count && goal.known_minutes + addition - release <= goal.limit_minutes);
}

function accountFits(account: Scope, pendingUnknown: number, addition: number, release: number): boolean {
  return account.limit_minutes === null || addition <= release ||
    (!pendingUnknown && account.known_minutes + addition - release <= account.limit_minutes);
}

export async function buildNextWeekCapacity(repository: LightTickRepository, owner: LightTickOwner, goal: LightTickGoalRow,
  startsOn: string, endsOn: string, today: string, timezone: string, existing: LightTickTaskRow[],
  goalTasks: LightTickTaskRow[], carries: LightTickTaskRow[]): Promise<NextWeekCapacitySnapshot> {
  const original = assertDailyCapacity(goal, startsOn, endsOn, [], goalTasks, new Set(), timezone, false);
  const calendar = await readCalendarConflicts(repository, owner, original.map(day => ({ date: day.date })), timezone);
  const weekly = await readAdviceWeekOccupancy(repository, owner, goal.id, startsOn, timezone, finiteGoalLimit(goal), existing);
  const account = scope(weekly.account.limit_minutes, weekly.account.known_minutes, weekly.account.unknown_count);
  const goalScope = scope(weekly.goal.limit_minutes, weekly.goal.known_minutes, weekly.goal.unknown_count);
  const account_pending_unknown = weekly.account.pending_unknown_count;
  const deadline = goal.targetDate?.slice(0, 10);
  const days = original.map(({ date, minutes, known_minutes, unknown_count }): DayAvailability => {
    const blocking_reason = date < today ? "past" : deadline && date > deadline ? "after_deadline" :
      calendar.planned_rest_dates.includes(date) ? "planned_rest" : calendar.unavailable_dates.includes(date) ? "unavailable_day" :
      minutes !== null && unknown_count ? "missing_estimate" : known_minutes >= (minutes ?? 1440) ? "daily_limit" : null;
    return { date, ...scope(minutes, known_minutes, unknown_count), blocking_reason };
  });
  const carry_credits = carries.flatMap((task): CarryCredit[] => {
    const date = taskScheduledDate(task, timezone);
    const minutes = taskRemainingEstimate(task);
    return date && date >= startsOn && date <= endsOn && minutes ? [{ id: task.id, date, minutes }] : [];
  });
  const eligible = days.filter(day => !calendarBlocked(day));
  const addOne = goalFits(goalScope, 1, 0) && accountFits(account, account_pending_unknown, 1, 0);
  const canCarry = eligible.some(day => carry_credits.some(credit => goalFits(goalScope, credit.minutes, credit.minutes) &&
    dailyFits(day, credit.minutes, day.date === credit.date ? credit.minutes : 0)));
  const fixedDailyOverage = days.some(day => (!deadline || day.date <= deadline) &&
    day.known_minutes - carry_credits.filter(credit => credit.date === day.date).reduce((total, credit) => total + credit.minutes, 0) >
    Math.min(day.limit_minutes ?? 1440, 1440));
  const can_schedule = !fixedDailyOverage && (canCarry || addOne && eligible.some(day => dailyFits(day, 1, 0)));
  const unknownBlock = account.limit_minutes !== null && account_pending_unknown > 0 ||
    goalScope.limit_minutes !== null && goalScope.unknown_count > 0 ||
    eligible.length > 0 && eligible.every(day => day.blocking_reason === "missing_estimate");
  const blocking_reason = can_schedule ? null : !eligible.length || fixedDailyOverage ? "no_eligible_dates" : unknownBlock ? "missing_estimate" :
    !addOne ? "weekly_limit" : "no_eligible_dates";
  return { availability: { timezone, starts_on: startsOn, ends_on: endsOn, can_schedule, blocking_reason, account,
    goal: goalScope, days }, account_pending_unknown, calendar, carry_credits };
}

export function nextWeekCapacityBasis({ availability, ...capacity }: NextWeekCapacitySnapshot) {
  // Business-day passage narrows the dates a person can select without changing the evidence they reviewed.
  const { can_schedule: _canSchedule, blocking_reason: _block, days, ...week } = availability;
  return { ...capacity, ...week, days: days.map(({ blocking_reason: _dayBlock, ...minutes }) => minutes) };
}

/** Recheck proposed or edited dates before presenting or confirming one possible schedule. */
export async function assertNextWeekSchedule(repository: LightTickRepository, owner: LightTickOwner, goal: LightTickGoalRow,
  draft: Pick<ManualDraft, "period_start" | "period_end" | "tasks">, current: NextWeekCapacitySnapshot, now: Date) {
  if (!draft.tasks.length) return;
  const { availability, carry_credits } = current;
  const { timezone, days } = availability;
  const calendar = { planned_rest_dates: [] as string[], unavailable_dates: [] as string[] };
  const datePolicy = new Map(days.map(day => [day.date, day.blocking_reason]));
  for (const action of draft.tasks) {
    const date = action.scheduled_for!;
    const reason = datePolicy.get(date);
    if (!datePolicy.has(date) || reason === "past" || reason === "after_deadline")
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Choose a remaining date within the reviewed goal's deadline.");
    if (reason === "planned_rest") calendar.planned_rest_dates.push(date);
    if (reason === "unavailable_day") calendar.unavailable_dates.push(date);
  }
  assertAvailableCalendarDates(calendar);
  const replacing = new Set(draft.tasks.flatMap(action => action.source_task_id ? [action.source_task_id] : []));
  const existing = await repository.listTasks(owner);
  const replacements = existing.filter(task => replacing.has(task.id));
  const input = await resolveManualPlanSubject(repository, goal, {
    ...draft, title: goal.title, completion_criteria: "",
  }, replacements, false);
  await assertWeeklyPlanningCapacity(repository, owner, draft.tasks.map(action => ({
    scheduledFor: action.scheduled_for ?? undefined, estimatedMinutes: action.estimated_minutes, goalId: goal.id,
    ...(input.subject_id ? { subjectId: input.subject_id } : {}), sourceTaskId: action.source_task_id,
  })), { existing, replacing, timezone, now, requireScheduledDate: true });
  const releases = carry_credits.filter(credit => replacing.has(credit.id));
  const totals = (proposals: CapacityAction[], credits: CarryCredit[]) => ({
    added: proposals.reduce((sum, action) => sum + (action.estimated_minutes ?? 0), 0),
    released: credits.reduce((sum, credit) => sum + credit.minutes, 0),
  });
  const { added, released } = totals(draft.tasks, releases);
  if (!goalFits(availability.goal, added, released))
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Review unestimated work and the confirmed goal budget before scheduling.");
  for (const day of days) {
    if (day.date < draft.period_start || day.date > draft.period_end) continue;
    const onDate = totals(draft.tasks.filter(action => action.scheduled_for === day.date), releases.filter(credit => credit.date === day.date));
    if (!dailyFits(day, onDate.added, onDate.released))
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "New work must fit the goal's confirmed daily capacity.");
  }
}

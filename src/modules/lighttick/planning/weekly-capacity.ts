import { ApplicationError } from "../../../shared/errors.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { businessDateAt, todayDateAt } from "../lighttick-today.service.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow, LightTickWeeklyPlanningBudget } from "../lighttick.types.ts";

const dayMs = 86_400_000;
const defaultBudget: LightTickWeeklyPlanningBudget = { version: 0, weekly_available_minutes: null, plan_percent: 80 };

export interface WeeklyCapacityAction {
  scheduledFor?: string;
  estimatedMinutes: number | null;
}

interface Occupancy {
  date: string;
  minutes: number | null;
  pending: boolean;
}

interface CapacitySources {
  tasks: LightTickTaskRow[];
  goals: LightTickGoalRow[];
  plans: LightTickPlanRow[];
}

const formatDate = (time: number) => new Date(time).toISOString().slice(0, 10);
function monday(date: string) {
  const day = new Date(date);
  return formatDate(+day - (day.getUTCDay() + 6) % 7 * dayMs);
}

function businessDate(value: string | undefined, timezone: string) {
  if (!value) return undefined;
  if (dateOnly(value)) return value;
  const instant = new Date(value);
  return Number.isFinite(+instant) ? businessDateAt(instant, timezone) : undefined;
}

function existingOccupancy(sources: CapacitySources, timezone: string, replacing: ReadonlySet<string> = new Set(), resumingGoalId?: string): Occupancy[] {
  const activeGoals = new Set(sources.goals.filter(goal =>
    ["active", "recovering"].includes(goal.status) || goal.id === resumingGoalId).map(goal => goal.id));
  const activePlans = new Set(sources.plans.filter(plan => plan.status === "active").map(plan => plan.id));
  const occupied: Occupancy[] = [];
  for (const task of sources.tasks) {
    const completed = task.status === "completed";
    if (!completed && (!activePlans.has(task.planId) || !activeGoals.has(task.goalId) || replacing.has(task.id) ||
      !["pending", "in_progress"].includes(task.status) || taskAwaitingExternalInput(task) || taskHasTransferredRemainingWork(task))) continue;
    const date = businessDate(completed ? task.completedAt ?? task.scheduledFor : task.scheduledFor, timezone);
    if (!date) continue;
    occupied.push({ date, pending: !completed,
      minutes: completed ? task.actualMinutes ?? task.estimatedMinutes : taskRemainingEstimate(task) ?? null });
  }
  return occupied;
}

function projectWeek(date: string, budget: LightTickWeeklyPlanningBudget, entries: Occupancy[]) {
  const starts_on = monday(date);
  const ends_on = formatDate(Date.parse(starts_on) + 6 * dayMs);
  const limit_minutes = budget.weekly_available_minutes === null ? null :
    Math.floor(budget.weekly_available_minutes * budget.plan_percent / 100);
  let known_minutes = 0, unknown_count = 0, pending_unknown_count = 0;
  for (const entry of entries) {
    if (entry.date < starts_on || entry.date > ends_on) continue;
    if (entry.minutes === null) {
      unknown_count++;
      if (entry.pending) pending_unknown_count++;
    } else known_minutes += entry.minutes;
  }
  return { starts_on, ends_on, limit_minutes, known_minutes, unknown_count, pending_unknown_count,
    remaining_minutes: limit_minutes === null || unknown_count > 0 ? null : Math.max(0, limit_minutes - known_minutes),
    over_limit: limit_minutes !== null && known_minutes > limit_minutes };
}

async function readSources(repository: LightTickRepository, owner: LightTickOwner, existing?: LightTickTaskRow[]): Promise<CapacitySources> {
  const [tasks, goals, plans] = await Promise.all([existing ?? repository.listTasks(owner), repository.listGoals(owner), repository.listPlans(owner)]);
  return { tasks, goals, plans };
}

export async function readWeeklyPlanningCapacity(repository: LightTickRepository, owner: LightTickOwner, now: Date, date?: unknown) {
  if (date !== undefined && !dateOnly(date)) throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a valid calendar date.");
  return repository.transaction(owner, async () => {
    const profile = await repository.getProfile(owner);
    const { timezone, businessDate: business_date } = todayDateAt(now, profile?.timezone ?? "UTC");
    const budget = await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget;
    const sources = await readSources(repository, owner);
    return { budget, timezone, business_date,
      week: projectWeek(typeof date === "string" ? date : business_date, budget, existingOccupancy(sources, timezone)) };
  });
}

export async function saveWeeklyPlanningCapacity(repository: LightTickRepository, owner: LightTickOwner,
  input: Record<string, unknown>, now: Date) {
  const base = input.base_version;
  const available = input.weekly_available_minutes;
  const percent = input.plan_percent;
  if (Object.keys(input).some(key => !["base_version", "weekly_available_minutes", "plan_percent"].includes(key)) ||
    !Number.isSafeInteger(base) || Number(base) < 0 ||
    (available !== null && (!Number.isInteger(available) || Number(available) < 0 || Number(available) > 10080)) ||
    (percent !== undefined && (!Number.isInteger(percent) || Number(percent) < 1 || Number(percent) > 100)))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Review the budget version, weekly minutes and planned percentage.");
  const current = await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget;
  if (current.version !== base) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The weekly planning budget changed. Review the current budget.");
  await repository.saveWeeklyPlanningBudget(owner, {
    version: current.version + 1, weekly_available_minutes: available as number | null, plan_percent: Number(percent ?? current.plan_percent),
  });
  return readWeeklyPlanningCapacity(repository, owner, now);
}

/** Call from the owner-locked transaction that commits dated work. Undated work is never charged. */
export async function assertWeeklyPlanningCapacity(repository: LightTickRepository, owner: LightTickOwner,
  actions: WeeklyCapacityAction[], options: { replacing?: ReadonlySet<string>; existing?: LightTickTaskRow[]; resumingGoalId?: string;
    timezone?: string; now?: Date; requireScheduledDate?: boolean } = {}) {
  if (!options.requireScheduledDate && !options.resumingGoalId && !actions.some(action => action.scheduledFor)) return;
  const budget = await repository.getWeeklyPlanningBudget(owner);
  if (!budget || budget.weekly_available_minutes === null) return;
  if (options.requireScheduledDate && actions.some(action => !action.scheduledFor))
    throw new ApplicationError(422, "REQ_FIELD_INVALID", "Choose a date for each action before confirming this plan with a shared weekly budget.");
  const { timezone, businessDate: today } = todayDateAt(options.now ?? new Date(), options.timezone ?? (await repository.getProfile(owner))?.timezone ?? "UTC");
  const additions: Occupancy[] = [];
  for (const action of actions) {
    if (!action.scheduledFor) continue;
    const date = businessDate(action.scheduledFor, timezone);
    if (!date || action.estimatedMinutes === null)
      throw new ApplicationError(422, "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Add an estimate before scheduling this work under the shared weekly budget.");
    additions.push({ date, minutes: action.estimatedMinutes, pending: true });
  }
  const sources = await readSources(repository, owner, options.existing);
  const before = existingOccupancy(sources, timezone);
  const after = [...existingOccupancy(sources, timezone, options.replacing, options.resumingGoalId), ...additions];
  const affectedWeeks = new Set(additions.map(item => monday(item.date)));
  if (options.resumingGoalId) {
    for (const item of after) {
      if (item.date >= monday(today)) affectedWeeks.add(monday(item.date));
    }
  }
  for (const week of affectedWeeks) {
    const current = projectWeek(week, budget, before);
    const next = projectWeek(week, budget, after);
    const addedLoad = next.known_minutes > current.known_minutes || next.pending_unknown_count > current.pending_unknown_count;
    if (addedLoad && next.pending_unknown_count > 0)
      throw new ApplicationError(422, "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Estimate this week's already scheduled work before adding workload across goals.");
    if (addedLoad && next.over_limit)
      throw new ApplicationError(422, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED", "This week's shared budget is exceeded. Reduce the proposed time or move work to another week.");
  }
}

export function isWeeklyPlanningCapacityError(error: unknown): boolean {
  return error instanceof ApplicationError &&
    (error.code === "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED" || error.code === "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED");
}

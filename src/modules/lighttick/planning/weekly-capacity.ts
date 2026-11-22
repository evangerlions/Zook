import { ApplicationError } from "../../../shared/errors.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { businessDateAt, todayDateAt } from "../lighttick-today.service.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow, LightTickWeeklyPlanningBudget } from "../lighttick.types.ts";
import { GOAL_SUBJECTS_KEY, readGoalSubjects, subjectIdForPlan, type GoalSubject } from "./goal-subjects.ts";

const dayMs = 86_400_000;
const defaultBudget: LightTickWeeklyPlanningBudget = { version: 0, weekly_available_minutes: null, plan_percent: 80 };

export interface WeeklyCapacityAction {
  scheduledFor?: string;
  estimatedMinutes: number | null;
  id?: string;
  planId?: string;
  goalId?: string;
  subjectId?: string | null;
  sourceTaskId?: string;
}

type SubjectScope = { goalId: string; subjectId: string };

interface Occupancy {
  date: string;
  minutes: number | null;
  pending: boolean;
  subject?: SubjectScope;
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

function subjectByPlan(plans: LightTickPlanRow[]): Map<string, SubjectScope> {
  const result = new Map<string, SubjectScope>();
  for (const plan of plans) {
    const subjectId = subjectIdForPlan(plan);
    if (subjectId) result.set(plan.id, { goalId: plan.goalId, subjectId });
  }
  return result;
}

function scopedOccupancy(entries: Occupancy[]) {
  const groups = new Map<string, Occupancy[]>();
  for (const entry of entries) {
    if (!entry.subject) continue;
    const key = subjectKey(entry.subject);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

const subjectKey = ({ goalId, subjectId }: SubjectScope) => goalId + ":" + subjectId;
const ownerLimit = (budget: LightTickWeeklyPlanningBudget) => budget.weekly_available_minutes === null ? null :
  Math.floor(budget.weekly_available_minutes * budget.plan_percent / 100);

function existingOccupancy(sources: CapacitySources, timezone: string, replacing: ReadonlySet<string> = new Set(), resumingGoalId?: string): Occupancy[] {
  const activeGoals = new Set(sources.goals.filter(goal =>
    ["active", "recovering"].includes(goal.status) || goal.id === resumingGoalId).map(goal => goal.id));
  const activePlans = new Set(sources.plans.filter(plan => plan.status === "active").map(plan => plan.id));
  const subjects = subjectByPlan(sources.plans);
  const occupied: Occupancy[] = [];
  for (const task of sources.tasks) {
    const completed = task.status === "completed";
    if (!completed && (!activePlans.has(task.planId) || !activeGoals.has(task.goalId) || replacing.has(task.id) ||
      !["pending", "in_progress"].includes(task.status) || taskAwaitingExternalInput(task) || taskHasTransferredRemainingWork(task))) continue;
    const date = businessDate(completed ? task.completedAt ?? task.scheduledFor : task.scheduledFor, timezone);
    if (!date) continue;
    const subject = subjects.get(task.planId);
    occupied.push({ date, pending: !completed, subject: subject?.goalId === task.goalId ? subject : undefined,
      minutes: completed ? task.actualMinutes ?? task.estimatedMinutes : taskRemainingEstimate(task) ?? null });
  }
  return occupied;
}

function projectWeek(date: string, limit_minutes: number | null, entries: Occupancy[]) {
  const starts_on = monday(date);
  const ends_on = formatDate(Date.parse(starts_on) + 6 * dayMs);
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

export function projectGoalSubjectUsage(goal: LightTickGoalRow, subjects: GoalSubject[], date: string,
  timezone: string, tasks: LightTickTaskRow[], plans: LightTickPlanRow[]) {
  const groups = scopedOccupancy(existingOccupancy({ tasks, plans, goals: [goal] }, timezone));
  const { starts_on, ends_on } = projectWeek(date, null, []);
  return { week: { starts_on, ends_on }, subjects: subjects.map(subject => {
    const key = subjectKey({ goalId: goal.id, subjectId: subject.id });
    const { known_minutes, unknown_count, pending_unknown_count, remaining_minutes, over_limit } =
      projectWeek(date, subject.weekly_minutes, groups.get(key) ?? []);
    return { ...subject, usage: { known_minutes, unknown_count, pending_unknown_count, remaining_minutes, over_limit } };
  }) };
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
      week: projectWeek(typeof date === "string" ? date : business_date, ownerLimit(budget), existingOccupancy(sources, timezone)) };
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
  const budget = ownerLimit(await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget);
  if (budget === null && !options.resumingGoalId && !options.replacing?.size &&
    !actions.some(action => action.subjectId || action.planId || action.sourceTaskId)) return;
  const { timezone, businessDate: today } = todayDateAt(options.now ?? new Date(), options.timezone ?? (await repository.getProfile(owner))?.timezone ?? "UTC");
  const sources = await readSources(repository, owner, options.existing);
  const planScopes = subjectByPlan(sources.plans);
  const taskById = new Map(sources.tasks.map(task => [task.id, task]));
  const replacement = options.replacing?.size === 1 ? [...options.replacing][0] : undefined;
  const scopeOf = (action: WeeklyCapacityAction) => {
    if (action.subjectId === null) return undefined;
    if (action.goalId && action.subjectId) return { goalId: action.goalId, subjectId: action.subjectId };
    const source = taskById.get(action.sourceTaskId ?? action.id ?? "") ??
      (replacement ? taskById.get(replacement) : undefined);
    const planId = action.planId ?? source?.planId;
    if (!planId) return undefined;
    const scope = planScopes.get(planId);
    const goalId = action.goalId ?? source?.goalId;
    return scope && (!goalId || scope.goalId === goalId) ? scope : undefined;
  };
  const caps = new Map<string, number>();
  for (const goal of sources.goals) {
    if (!Object.hasOwn(goal.constraints, GOAL_SUBJECTS_KEY)) continue;
    for (const subject of readGoalSubjects(goal).subjects) {
      if (subject.weekly_minutes !== null) caps.set(subjectKey({ goalId: goal.id, subjectId: subject.id }), subject.weekly_minutes);
    }
  }
  const additions: Occupancy[] = [];
  for (const action of actions) {
    const subject = scopeOf(action);
    const capped = !!subject && caps.has(subjectKey(subject));
    if ((budget !== null || capped) && options.requireScheduledDate && !action.scheduledFor)
      throw new ApplicationError(422, "REQ_FIELD_INVALID", "Choose a date for each action before confirming this plan with a weekly budget.");
    if (!action.scheduledFor) continue;
    const date = businessDate(action.scheduledFor, timezone);
    if (!date || action.estimatedMinutes === null) {
      if (budget !== null)
        throw new ApplicationError(422, "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Add an estimate before scheduling this work under the shared weekly budget.");
      if (capped)
        throw new ApplicationError(422, "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Add an estimate before scheduling work for this subject.");
    }
    if (date) additions.push({ date, minutes: action.estimatedMinutes, pending: true, subject });
  }
  const before = existingOccupancy(sources, timezone);
  const after = [...existingOccupancy(sources, timezone, options.replacing, options.resumingGoalId), ...additions];
  const affectedWeeks = new Set(additions.map(item => monday(item.date)));
  if (options.resumingGoalId) {
    for (const item of after) {
      if (item.date >= monday(today)) affectedWeeks.add(monday(item.date));
    }
  }
  if (budget !== null) for (const week of affectedWeeks) {
    checkWeekIncrease(week, budget, before, after);
  }
  if (caps.size > 0 && affectedWeeks.size > 0) {
    const beforeGroups = scopedOccupancy(before), afterGroups = scopedOccupancy(after);
    for (const [key, entries] of afterGroups) {
      const cap = caps.get(key);
      if (cap === undefined) continue;
      for (const week of affectedWeeks) checkWeekIncrease(week, cap, beforeGroups.get(key) ?? [], entries, true);
    }
  }
}

function checkWeekIncrease(week: string, cap: number, before: Occupancy[], after: Occupancy[], subject = false) {
  const current = projectWeek(week, cap, before), next = projectWeek(week, cap, after);
  const addedLoad = next.known_minutes > current.known_minutes || next.pending_unknown_count > current.pending_unknown_count;
  if (!addedLoad) return;
  if (next.pending_unknown_count > 0)
    throw new ApplicationError(422, subject ? "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED" : "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED",
      subject ? "Estimate this subject's already scheduled work before adding workload." : "Estimate this week's already scheduled work before adding workload across goals.");
  if (next.over_limit)
    throw new ApplicationError(422, subject ? "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_EXCEEDED" : "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED",
      subject ? "This subject's weekly budget is exceeded. Reduce the proposed time or use another week." :
        "This week's shared budget is exceeded. Reduce the proposed time or move work to another week.");
}

export function isWeeklyPlanningCapacityError(error: unknown): boolean {
  return error instanceof ApplicationError &&
    (error.code === "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED" || error.code === "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED" ||
      error.code === "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_EXCEEDED" || error.code === "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED");
}

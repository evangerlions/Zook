import { ApplicationError } from "../../../shared/errors.ts";
import { dateOnly } from "../manual/manual-planning.types.ts";
import { businessDateAt, todayDateAt } from "../lighttick-today.service.ts";
import { isOrdinaryTaskMissingEstimate, taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "../lighttick-task-progress.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow, LightTickWeeklyPlanningBudget } from "../lighttick.types.ts";
import { assertAvailableCalendarDates, readCalendarConflicts } from "./planning-calendar-admission.ts";
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
  task?: LightTickTaskRow;
}

interface CapacitySources {
  tasks: LightTickTaskRow[];
  goals: LightTickGoalRow[];
  plans: LightTickPlanRow[];
}

type WeeklyCapacityOptions = { replacing?: ReadonlySet<string>; existing?: LightTickTaskRow[]; resumingGoalId?: string;
  timezone?: string; now?: Date; requireScheduledDate?: boolean };

type WeekBlock = "over_limit" | "missing_estimate";
type CapacityIssue = { reason: WeekBlock | "missing_date"; subject: boolean; proposed?: boolean };

const issueErrors = {
  missing_date: ["REQ_FIELD_INVALID", "Choose a date for each action before confirming this plan with a weekly budget."],
  account_proposed_estimate: ["LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Add an estimate before scheduling this work under the shared weekly budget."],
  subject_proposed_estimate: ["LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Add an estimate before scheduling work for this subject."],
  account_occupied_estimate: ["LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Estimate this week's already scheduled work before adding workload across goals."],
  subject_occupied_estimate: ["LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED", "Estimate this subject's already scheduled work before adding workload."],
  account_over_limit: ["LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED", "This week's shared budget is exceeded. Reduce the proposed time or move work to another week."],
  subject_over_limit: ["LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_EXCEEDED", "This subject's weekly budget is exceeded. Reduce the proposed time or use another week."],
} as const;

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

export async function readWeeklyPlanableMinutes(repository: LightTickRepository, owner: LightTickOwner) {
  return ownerLimit(await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget);
}

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
    occupied.push({ date, task, pending: !completed, subject: subject?.goalId === task.goalId ? subject : undefined,
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
  const tasks = existing ?? await repository.listTasks(owner);
  const goals = await repository.listGoals(owner);
  const plans = await repository.listPlans(owner);
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

/** Keep the same scheduled load and completed history counts when a goal reviews next week's work. */
export async function readAdviceWeekOccupancy(repository: LightTickRepository, owner: LightTickOwner, goalId: string,
  startsOn: string, timezone: string, goalLimit: number | null, existing: LightTickTaskRow[]) {
  const budget = await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget;
  const entries = existingOccupancy(await readSources(repository, owner, existing), timezone);
  return {
    account: projectWeek(startsOn, ownerLimit(budget), entries),
    goal: projectWeek(startsOn, goalLimit, entries.filter(entry => entry.task?.goalId === goalId)),
  };
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
  actions: WeeklyCapacityAction[], options: WeeklyCapacityOptions = {}) {
  const dated = actions.some(action => action.scheduledFor);
  if (!options.requireScheduledDate && !options.resumingGoalId && !dated) return;
  if (dated) assertAvailableCalendarDates(await checkCalendarDates(repository, owner, actions, options));
  const budget = ownerLimit(await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget);
  if (budget === null && !options.resumingGoalId && !options.replacing?.size &&
    !actions.some(action => action.subjectId || action.planId || action.sourceTaskId)) return;
  const { issue } = await assessWeeklyCapacity(repository, owner, budget, actions, options);
  if (!issue) return;
  const scope = issue.subject ? "subject" : "account";
  const [code, message] = issue.reason === "missing_date" ? issueErrors.missing_date : issue.reason === "over_limit" ?
    issueErrors[`${scope}_over_limit`] : issueErrors[`${scope}_${issue.proposed ? "proposed" : "occupied"}_estimate`];
  throw new ApplicationError(422, code, message);
}

export async function previewWeeklyPlanningCapacity(repository: LightTickRepository, owner: LightTickOwner,
  actions: WeeklyCapacityAction[], options: WeeklyCapacityOptions = {}) {
  const budget = ownerLimit(await repository.getWeeklyPlanningBudget(owner) ?? defaultBudget);
  const { issue, ...preview } = await assessWeeklyCapacity(repository, owner, budget, actions, options, true);
  const { planned_rest_dates, unavailable_dates } = await checkCalendarDates(repository, owner, actions, { ...options, timezone: preview.timezone });
  const block_reason = planned_rest_dates.length ? "planned_rest" as const : unavailable_dates.length ? "unavailable_days" as const : issue?.reason ?? null;
  return { ...preview, ...(planned_rest_dates.length ? { planned_rest_dates } : {}),
    ...(unavailable_dates.length ? { unavailable_dates } : {}), block_reason };
}

async function checkCalendarDates(repository: LightTickRepository, owner: LightTickOwner,
  actions: WeeklyCapacityAction[], options: WeeklyCapacityOptions) {
  const { timezone } = todayDateAt(options.now ?? new Date(),
    options.timezone ?? (await repository.getProfile(owner))?.timezone ?? "UTC");
  const candidates = actions.map(action => ({
    id: action.id && options.replacing?.has(action.id) ? action.id : undefined,
    date: businessDate(action.scheduledFor, timezone),
  }));
  return readCalendarConflicts(repository, owner, candidates, timezone, options.existing);
}

async function assessWeeklyCapacity(repository: LightTickRepository, owner: LightTickOwner, budget: number | null,
  actions: WeeklyCapacityAction[], options: WeeklyCapacityOptions, includeEstimateTasks = false) {
  const { timezone, businessDate: business_date } = todayDateAt(options.now ?? new Date(),
    options.timezone ?? (await repository.getProfile(owner))?.timezone ?? "UTC");
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
  let issue: CapacityIssue | undefined;
  let undated_action_count = 0;
  for (const action of actions) {
    const subject = scopeOf(action);
    const capped = !!subject && caps.has(subjectKey(subject));
    if (!action.scheduledFor) {
      undated_action_count++;
      if ((budget !== null || capped) && options.requireScheduledDate) issue ??= { reason: "missing_date", subject: false };
      continue;
    }
    const date = businessDate(action.scheduledFor, timezone);
    if (!date || action.estimatedMinutes === null) {
      if (budget !== null || capped) issue ??= { reason: "missing_estimate", subject: budget === null, proposed: true };
    }
    if (date) additions.push({ date, minutes: action.estimatedMinutes, pending: true, subject });
  }
  const before = existingOccupancy(sources, timezone);
  const retained = existingOccupancy(sources, timezone, options.replacing, options.resumingGoalId);
  const after = [...retained, ...additions];
  const affectedWeeks = new Set(additions.map(item => monday(item.date)));
  if (options.resumingGoalId) {
    for (const item of after) {
      if (item.date >= monday(business_date)) affectedWeeks.add(monday(item.date));
    }
  }
  const weeks = [...affectedWeeks].map(week => summarizeWeek(week, budget, before, retained, additions));
  const accountBlock = weeks.find(week => week.blocking)?.blocking;
  if (accountBlock) issue ??= { reason: accountBlock, subject: false };
  const visibleSubjectWeeks = new Set<string>();
  if (caps.size > 0 && affectedWeeks.size > 0) {
    const beforeGroups = scopedOccupancy(before), afterGroups = scopedOccupancy(after),
      retainedGroups = scopedOccupancy(retained), proposedGroups = scopedOccupancy(additions);
    for (const [key, entries] of afterGroups) {
      const cap = caps.get(key);
      const subjectId = entries[0]?.subject?.subjectId;
      if (cap === undefined || !subjectId) continue;
      for (const week of affectedWeeks) {
        const leg = summarizeWeek(week, cap, beforeGroups.get(key) ?? [], retainedGroups.get(key) ?? [],
          proposedGroups.get(key) ?? [], subjectId);
        if (leg.blocking || leg.proposed_minutes || leg.unknown_proposed_count || leg.current_minutes !== leg.retained_minutes) {
          weeks.push(leg);
          visibleSubjectWeeks.add(`${week}:${key}`);
        }
        if (leg.blocking) issue ??= { reason: leg.blocking, subject: true };
      }
    }
  }
  weeks.sort((first, second) => first.starts_on.localeCompare(second.starts_on) || first.scope.localeCompare(second.scope));
  const estimateTasks = includeEstimateTasks
    ? retainedEstimateTasks(sources, retained, affectedWeeks, visibleSubjectWeeks, budget, business_date)
    : [];
  return { business_date, timezone, weeks, undated_action_count, issue,
    ...(estimateTasks.length > 0 ? { estimate_tasks: estimateTasks } : {}) };
}

function retainedEstimateTasks(sources: CapacitySources, retained: Occupancy[], affectedWeeks: Set<string>,
  visibleSubjectWeeks: Set<string>, budget: number | null, businessDate: string) {
  const goalById = new Map(sources.goals.map(goal => [goal.id, goal]));
  const planById = new Map(sources.plans.map(plan => [plan.id, plan]));
  const currentWeek = monday(businessDate);
  const tasks = retained.flatMap(({ task, date, minutes, pending, subject }) => {
    if (!task || !pending || minutes !== null) return [];
    const week = monday(date);
    const chargedToAccount = budget !== null && affectedWeeks.has(week);
    const chargedToSubject = subject && visibleSubjectWeeks.has(`${week}:${subjectKey(subject)}`);
    if ((!chargedToAccount && !chargedToSubject) ||
      !isOrdinaryTaskMissingEstimate(task, goalById.get(task.goalId), planById.get(task.planId))) return [];
    return [{ task_id: task.id, title: task.title, scheduled_date: date, version: task.version, editable: week >= currentWeek }];
  });
  return tasks.sort((first, second) => first.scheduled_date.localeCompare(second.scheduled_date) || first.task_id.localeCompare(second.task_id));
}

function summarizeWeek(week: string, cap: number | null, before: Occupancy[], retained: Occupancy[], additions: Occupancy[], subjectId?: string) {
  const current = projectWeek(week, cap, before);
  const existing = projectWeek(week, cap, retained);
  const proposed = projectWeek(week, cap, additions);
  const projected = existing.known_minutes + proposed.known_minutes;
  const pendingUnknown = existing.pending_unknown_count + proposed.pending_unknown_count;
  const additionalLoad = projected > current.known_minutes || pendingUnknown > current.pending_unknown_count;
  const shortfall = cap === null ? null : Math.max(0, projected - cap);
  let blocking: WeekBlock | null = null;
  if (cap !== null) {
    if (proposed.pending_unknown_count || (additionalLoad && pendingUnknown)) blocking = "missing_estimate";
    else if (shortfall && additionalLoad) blocking = "over_limit";
  }
  return { starts_on: existing.starts_on, ends_on: existing.ends_on, scope: subjectId ? "subject" as const : "account" as const,
    ...(subjectId && { subject_id: subjectId }), limit_minutes: cap, current_minutes: current.known_minutes,
    retained_minutes: existing.known_minutes, proposed_minutes: proposed.known_minutes, projected_minutes: projected,
    shortfall_minutes: shortfall, unknown_scheduled_count: existing.pending_unknown_count,
    unknown_proposed_count: proposed.pending_unknown_count,
    unknown_completed_count: existing.unknown_count - existing.pending_unknown_count, blocking };
}

export function isWeeklyPlanningCapacityError(error: unknown): boolean {
  return error instanceof ApplicationError &&
    (error.code === "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED" || error.code === "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED" ||
      error.code === "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_EXCEEDED" || error.code === "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED");
}

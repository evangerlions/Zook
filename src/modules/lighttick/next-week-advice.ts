import { ApplicationError } from "../../shared/errors.ts";
import { sha256 } from "../../shared/utils.ts";
import { assertDailyCapacity } from "./goal-context/confirmed-conditions.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import { taskAwaitingExternalInput, taskHasTransferredRemainingWork, taskRemainingEstimate } from "./lighttick-task-progress.ts";
import { businessDateAt } from "./lighttick-today.service.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "./lighttick.types.ts";
import { NEXT_WEEK_EXCERPT_LIMIT, parseNextWeekOutcomeSource, readNextWeekOutcomeSource,
  type NextWeekOutcomeSource, type NextWeekStageOutcomeFact } from "./planning/next-week-outcome-source.ts";
import { buildNextWeekCapacity, nextWeekCapacityBasis, type NextWeekCapacitySnapshot } from "./planning/next-week-capacity.ts";
import { taskPrerequisiteOf } from "./planning/task-prerequisite.ts";

interface NextWeekSource { reflection_id: string; reflection_version: number; excerpt: string; }

interface NextWeekWindow {
  period_start: string;
  period_end: string;
  next_period_start: string;
  next_period_end: string;
  source?: NextWeekSource;
  outcome_source?: NextWeekOutcomeSource;
}

type NextWeekFact = {
  id: string;
  title: string;
  occurred_on?: string;
  actual_minutes?: number;
  remaining_estimated_minutes?: number | null;
} & ({ kind: "partial" | "completed" | "skipped" | "waiting" | "scheduled" | "reflection_excerpt" } | NextWeekStageOutcomeFact);

export interface NextWeekContext extends NextWeekWindow {
  goal_id: string;
  goal_title: string;
  target_date?: string;
  facts: NextWeekFact[];
  capacity?: NextWeekCapacitySnapshot;
  availability: { weekly_minutes: number | null; days: { date: string; limit_minutes: number | null; known_minutes: number; unknown_count: number }[] };
  carry_sources: { id: string; version: number; remaining_estimated_minutes: number | null; evidence_ids: string[] }[];
  fingerprint: string;
}

interface AdviceTask {
  title: string;
  scheduled_for: string;
  estimated_minutes: number;
  completion_criteria: string;
  reason: string;
  evidence_ids: string[];
  source_task_id?: string;
}

export interface NextWeekAdvice {
  decision: "keep" | "adjust";
  summary: string;
  tasks: (AdviceTask & { id: string })[];
}

const day = 86_400_000;
const evidenceLimit = 16;
const allowedEvidenceEvents = {
  task_partial_completed: "partial", task_complete: "completed", task_skip: "skipped", task_waiting: "waiting",
} as const;

function badWindow(): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a review window and the next Monday through Sunday.");
}

function stale(): never {
  throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The weekly evidence changed. Review the current information before requesting another suggestion.");
}

export function assertNextWeekAiEnabled(available: boolean): void {
  if (!available) throw new ApplicationError(503, "LIGHTTICK_AI_UNAVAILABLE", "AI suggestions are unavailable. You can still review and plan manually.");
}

function dateAt(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && dateAt(Date.parse(value)) === value;
}

export function nextWeekRange(now: Date, timezone: string): { start: string; end: string } {
  const current = Date.parse(businessDateAt(now, timezone));
  const daysSinceMonday = (new Date(current).getUTCDay() + 6) % 7;
  const start = current + (7 - daysSinceMonday) * day;
  return { start: dateAt(start), end: dateAt(start + 6 * day) };
}

function minutes(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1440 ? value : undefined;
}

function taskDate(task: LightTickTaskRow, timezone: string): string | undefined {
  if (!task.scheduledFor) return undefined;
  return isDate(task.scheduledFor) ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone);
}

function taskOrder(left: LightTickTaskRow, right: LightTickTaskRow): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

type AdviceDates = Pick<NextWeekWindow, "period_end" | "next_period_start" | "next_period_end">;

function ownTaskInventory(goalId: string, allTasks: LightTickTaskRow[], plans: LightTickPlanRow[], dates: AdviceDates,
  timezone: string, currentCapacity: boolean) {
  const active = new Set(plans.filter(plan => plan.status === "active").map(plan => plan.id));
  const tasks = allTasks.filter(task => task.goalId === goalId).sort(taskOrder);
  const ordinary = tasks.filter(task => !task.lessonSource);
  const byId = new Map(ordinary.map(task => [task.id, task]));
  const open = (task: LightTickTaskRow) => active.has(task.planId) && (task.status === "pending" || task.status === "in_progress") &&
    !taskAwaitingExternalInput(task) && !taskHasTransferredRemainingWork(task);
  const latestCarryDate = currentCapacity ? dates.next_period_end : dates.period_end;
  const carries = ordinary.filter(task => {
    if (!open(task) || !task.executionProgress?.outcome || (taskDate(task, timezone) ?? dates.period_end) > latestCarryDate)
      return false;
    return !currentCapacity || !task.prerequisiteTaskId || taskPrerequisiteOf(task, byId.get(task.prerequisiteTaskId))?.state === "complete";
  }).slice(0, 8);
  const dated = tasks.filter(task => active.has(task.planId) || task.status === "completed");
  return { active, tasks, ordinary, byId, open, carries, dated };
}

export async function readNextWeekAvailability(repository: LightTickRepository, owner: LightTickOwner,
  goal: LightTickGoalRow, dates: AdviceDates, now: Date, timezone: string) {
  const allTasks = await repository.listTasks(owner);
  const plans = await repository.listPlans(owner, goal.id);
  const { carries, dated } = ownTaskInventory(goal.id, allTasks, plans, dates, timezone, true);
  const { availability } = await buildNextWeekCapacity(repository, owner, goal, dates.next_period_start, dates.next_period_end,
    businessDateAt(now, timezone), timezone, allTasks, dated, carries);
  return availability;
}

export async function loadNextWeekContext(repository: LightTickRepository, owner: LightTickOwner,
  goalId: string, options: NextWeekWindow, now: Date): Promise<NextWeekContext> {
  return await buildContext(repository, owner, goalId, options, now, true, true);
}

async function buildContext(repository: LightTickRepository, owner: LightTickOwner,
  goalId: string, options: NextWeekWindow, now: Date, requireNextWeek: boolean, currentCapacity: boolean): Promise<NextWeekContext> {
  const { period_start, period_end, next_period_start, next_period_end, source } = options;
  if (![period_start, period_end, next_period_start, next_period_end].every(isDate) ||
      period_start > period_end || period_end >= next_period_start ||
      Date.parse(period_end) - Date.parse(period_start) > 30 * day ||
      new Date(next_period_start + "T00:00:00Z").getUTCDay() !== 1 ||
      Date.parse(next_period_end) - Date.parse(next_period_start) !== 6 * day) badWindow();

  const goal = await repository.getGoal(owner, goalId);
  if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
  if (goal.status !== "active") stale();
  const goalDate = currentCapacity ? goal.targetDate?.slice(0, 10) : goal.targetDate;
  const targetDate = isDate(goalDate) ? goalDate : undefined;
  const profile = await repository.getProfile(owner);
  const timezone = profile?.timezone ?? "UTC";
  const today = businessDateAt(now, timezone);
  if (!requireNextWeek && next_period_end < today) stale();
  if (requireNextWeek) {
    const next = nextWeekRange(now, timezone);
    if (next_period_start !== next.start || next_period_end !== next.end) badWindow();
  }

  let selectedSource: NextWeekSource | undefined;
  if (source !== undefined) {
    if (!source || typeof source.reflection_id !== "string" || !Number.isInteger(source.reflection_version) ||
        source.reflection_version < 1 || typeof source.excerpt !== "string" || !source.excerpt.trim() ||
        source.excerpt.length > NEXT_WEEK_EXCERPT_LIMIT) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Select an exact excerpt of no more than 500 characters.");
    }
    const reflection = (await repository.listReflections(owner)).find(row => row.id === source.reflection_id && row.goalId === goalId);
    if (!reflection) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Reflection was not found for this goal.");
    if (reflection.version !== source.reflection_version || reflection.periodStart > period_end ||
        reflection.periodEnd < period_start || !reflection.content.includes(source.excerpt)) stale();
    selectedSource = { reflection_id: source.reflection_id, reflection_version: source.reflection_version, excerpt: source.excerpt };
  }

  const outcomeSource = parseNextWeekOutcomeSource(options.outcome_source);
  const selectedOutcome = outcomeSource ? await readNextWeekOutcomeSource(repository, owner, goal, outcomeSource,
    period_start, today < period_end ? today : period_end) : undefined;
  const plans = await repository.listPlans(owner, goalId);
  const allTasks = await repository.listTasks(owner);
  const { active, tasks, ordinary, byId, open, carries: carryTasks, dated } = ownTaskInventory(goalId, allTasks, plans, options, timezone, currentCapacity);
  const capacity = currentCapacity ? await buildNextWeekCapacity(repository, owner, goal, next_period_start, next_period_end, today, timezone,
    allTasks, dated, carryTasks) : undefined;
  const from = new Date(Date.parse(period_start) - 2 * day).toISOString();
  const to = new Date(Date.parse(period_end) + 3 * day).toISOString();
  const windowEvents = (await repository.listExecutionEvents(owner, from, to, goalId)).flatMap(event => {
    const task = byId.get(event.aggregateId);
    if (!task || event.aggregateType !== "task" || !Object.hasOwn(allowedEvidenceEvents, event.eventType) ||
        Date.parse(event.occurredAt) > now.valueOf()) return [];
    const occurred_on = businessDateAt(new Date(event.occurredAt), timezone);
    if (occurred_on < period_start || occurred_on > period_end) return [];
    const kind = allowedEvidenceEvents[event.eventType as keyof typeof allowedEvidenceEvents];
    const actual = minutes(event.payload.actual_minutes);
    const remaining = event.payload.remaining_estimated_minutes;
    return [{ taskId: task.id, time: event.occurredAt, fact: {
      id: event.id, kind, title: task.title.slice(0, 100), occurred_on,
      ...(actual === undefined ? {} : { actual_minutes: actual }),
      ...(kind === "partial" && (remaining === null || minutes(remaining) !== undefined)
        ? { remaining_estimated_minutes: remaining as number | null } : {}),
    } satisfies NextWeekFact }];
  }).sort((left, right) => right.time.localeCompare(left.time) || left.fact.id.localeCompare(right.fact.id));

  const carryFacts: NextWeekFact[] = carryTasks.map(task => ({
    id: `remaining:${task.id}`, kind: "partial", title: task.title.slice(0, 100),
    remaining_estimated_minutes: taskRemainingEstimate(task) ?? null,
  }));
  const scheduledFacts: NextWeekFact[] = ordinary.flatMap(task => {
    const scheduled = taskDate(task, timezone);
    if (!open(task) || !scheduled || scheduled < next_period_start || scheduled > next_period_end) return [];
    return [{ id: `scheduled:${task.id}`, kind: "scheduled", title: task.title.slice(0, 100), occurred_on: scheduled,
      remaining_estimated_minutes: taskRemainingEstimate(task) ?? null } satisfies NextWeekFact];
  }).slice(0, 5);
  const reflectionFacts: NextWeekFact[] = selectedSource
    ? [{ id: `reflection:${selectedSource.reflection_id}`, kind: "reflection_excerpt", title: "本人选中的回顾片段" }] : [];
  const facts = [...carryFacts, ...reflectionFacts, ...(selectedOutcome ? [selectedOutcome.fact] : []),
    ...scheduledFacts, ...windowEvents.map(event => event.fact)].slice(0, evidenceLimit);
  const evidenceIds = new Set(facts.map(fact => fact.id));
  const carry_sources = carryTasks.map(task => ({
    id: task.id, version: task.version,
    remaining_estimated_minutes: taskRemainingEstimate(task) ?? null,
    evidence_ids: [`remaining:${task.id}`, ...windowEvents.filter(event =>
      event.taskId === task.id && event.fact.kind === "partial" && evidenceIds.has(event.fact.id)).map(event => event.fact.id)],
  }));
  const weekly = goal.constraints.weekly_available_minutes;
  const availability: NextWeekContext["availability"] = {
    weekly_minutes: typeof weekly === "number" && Number.isInteger(weekly) && weekly >= 1 && weekly <= 10080 ? weekly : null,
    days: assertDailyCapacity(goal, next_period_start, next_period_end, [], dated, new Set(), timezone, false)
      .map(value => ({ date: value.date, limit_minutes: value.minutes, known_minutes: value.known_minutes, unknown_count: value.unknown_count })),
  };
  const relevantTaskIds = new Set(windowEvents.map(event => event.taskId));
  const relevantPlans = new Set(tasks.filter(task => relevantTaskIds.has(task.id)).map(task => task.planId));
  const fingerprint = sha256(JSON.stringify({
    owner: [owner.appId, owner.userId],
    goal: [goal.id, goal.version, goal.status, targetDate],
    profile: [profile?.version, timezone],
    dates: [period_start, period_end, next_period_start, next_period_end],
    plans: plans.filter(plan => active.has(plan.id) || relevantPlans.has(plan.id)).map(plan => [plan.id, plan.version]).sort(),
    tasks: tasks.filter(task => active.has(task.planId) || relevantTaskIds.has(task.id))
      .map(task => [task.id, task.version]).sort(),
    events: windowEvents.map(event => event.fact.id).sort(),
    source: selectedSource, facts, availability,
    ...(selectedOutcome ? { outcomeVersion: selectedOutcome.version } : {}),
    ...(capacity ? { capacity: nextWeekCapacityBasis(capacity) } : {}),
  }));
  return { goal_id: goal.id, goal_title: goal.title.slice(0, 160), period_start, period_end, next_period_start, next_period_end,
    facts, availability, carry_sources, fingerprint, ...(capacity ? { capacity } : {}), ...(targetDate ? { target_date: targetDate } : {}),
    ...(selectedSource ? { source: selectedSource } : {}), ...(outcomeSource ? { outcome_source: outcomeSource } : {}) };
}

export async function assertNextWeekContextCurrent(repository: LightTickRepository, owner: LightTickOwner,
  recorded: NextWeekContext, now: Date): Promise<NextWeekContext> {
  if (!recorded || typeof recorded.goal_id !== "string" || !/^[a-f0-9]{64}$/.test(recorded.fingerprint)) stale();
  let current: NextWeekContext;
  try {
    current = await buildContext(repository, owner, recorded.goal_id, recorded, now, false, recorded.capacity !== undefined);
  } catch (error) {
    if (error instanceof ApplicationError && [400, 404, 409, 422].includes(error.statusCode)) stale();
    throw error;
  }
  if (current.fingerprint !== recorded.fingerprint) stale();
  return current;
}

const smallText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
export const NEXT_WEEK_ADVICE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["decision", "summary", "tasks"],
  properties: {
    decision: { type: "string", enum: ["keep", "adjust"] }, summary: smallText(350),
    tasks: { type: "array", maxItems: 3, items: {
      type: "object", additionalProperties: false,
      required: ["title", "scheduled_for", "estimated_minutes", "completion_criteria", "reason", "evidence_ids"],
      properties: {
        title: smallText(160), scheduled_for: { type: "string", format: "date" },
        estimated_minutes: { type: "integer", minimum: 1, maximum: 1440 },
        completion_criteria: smallText(350), reason: smallText(350),
        evidence_ids: { type: "array", minItems: 1, maxItems: 6, uniqueItems: true, items: smallText(200) },
        source_task_id: smallText(128),
      },
    } },
  },
} as const;

function invalidAdvice(): never {
  throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "The suggestion did not match the reviewed dates or evidence.");
}

function safeText(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) invalidAdvice();
  return value.trim();
}

export function validateNextWeekAdvice(value: Record<string, unknown>, context: NextWeekContext): NextWeekAdvice {
  const { decision, tasks } = value;
  if (Object.keys(value).some(key => !["decision", "summary", "tasks"].includes(key)) ||
      (decision !== "keep" && decision !== "adjust") || !Array.isArray(tasks) || tasks.length > 3 ||
      (decision === "keep" ? tasks.length !== 0 : tasks.length === 0 || context.capacity?.availability.can_schedule === false)) invalidAdvice();
  const knownIds = new Set(context.facts.map(fact => fact.id));
  const sources = new Map(context.carry_sources.map(source => [source.id, source]));
  const proposedSources = new Set<string>();
  const proposedActions = new Set<string>();
  return { decision, summary: safeText(value.summary, 350), tasks: tasks.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key =>
      !["title", "scheduled_for", "estimated_minutes", "completion_criteria", "reason", "evidence_ids", "source_task_id"].includes(key))) invalidAdvice();
    const { scheduled_for, estimated_minutes, evidence_ids, source_task_id } = input as Record<string, unknown>;
    const estimate = minutes(estimated_minutes);
    if (!isDate(scheduled_for) || scheduled_for < context.next_period_start || scheduled_for > context.next_period_end ||
        (context.target_date && scheduled_for > context.target_date) ||
        estimate === undefined || !Array.isArray(evidence_ids) || !evidence_ids.length || evidence_ids.length > 6 ||
        new Set(evidence_ids).size !== evidence_ids.length || evidence_ids.some(id => typeof id !== "string" || !knownIds.has(id))) invalidAdvice();
    if (source_task_id !== undefined) {
      const source = typeof source_task_id === "string" ? sources.get(source_task_id) : undefined;
      if (typeof source_task_id !== "string" || !source || proposedSources.has(source_task_id) ||
          (source.remaining_estimated_minutes === null ? context.capacity !== undefined : estimate < source.remaining_estimated_minutes) ||
          !source.evidence_ids.some(id => evidence_ids.includes(id))) invalidAdvice();
      proposedSources.add(source_task_id);
    }
    const title = safeText(input.title, 160);
    const identity = JSON.stringify([title.normalize("NFKC").replace(/\s+/gu, " ").toLowerCase(), scheduled_for]);
    if (proposedActions.has(identity)) invalidAdvice();
    proposedActions.add(identity);
    return { id: `step-${index + 1}`, title, scheduled_for, estimated_minutes: estimate,
      completion_criteria: safeText(input.completion_criteria, 350), reason: safeText(input.reason, 350),
      evidence_ids: evidence_ids as string[], ...(typeof source_task_id === "string" ? { source_task_id } : {}) };
  }) };
}

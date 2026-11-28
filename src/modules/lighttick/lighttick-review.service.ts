import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickExecutionEventRow, LightTickOwner, LightTickReviewRow } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { businessDateAt } from "./lighttick-today.service.ts";

const terminalTaskEvents = new Set(["task_complete", "task_skip", "task_defer", "task_cancel"]);
const progressTaskEvents = new Set(["task_partial_completed", "task_remaining_estimated", "task_waiting", "task_resumed",
  "task_remaining_transferred", "task_remaining_created"]);

function progressEvidence(event: LightTickExecutionEventRow) {
  const payload = event.payload;
  const remaining = payload.remaining_estimated_minutes;
  const waiting = payload.waiting as { check_date?: unknown } | undefined;
  // Review facts can be used by the model. Keep authored outcome, remaining-work, and waiting text with the source task.
  return {
    type: event.eventType,
    occurred_at: event.occurredAt,
    ...(typeof payload.actual_minutes === "number" ? { actual_minutes: payload.actual_minutes } : {}),
    ...(typeof remaining === "number" || remaining === null ? { remaining_estimated_minutes: remaining } : {}),
    ...(typeof waiting?.check_date === "string" ? { check_date: waiting.check_date } : {}),
    ...(typeof payload.transferred_to_task_id === "string" ? { transferred_to_task_id: payload.transferred_to_task_id } : {}),
    ...(typeof payload.split_from_task_id === "string" ? { split_from_task_id: payload.split_from_task_id } : {}),
  };
}

export class LightTickReviewService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async create(owner: LightTickOwner, goalId: string, period: "day" | "week" | "month", periodStart: string,
    periodEnd: string, options: { planId?: string; fresh?: boolean; notes?: Record<string, unknown> } = {}): Promise<LightTickReviewRow> {
    const notes: Record<string, string> = {};
    for (const [key, limit] of Object.entries({ mood: 100, next_action: 1000, self_reflection: 4000 })) {
      const value = options.notes?.[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > limit)
        throw new ApplicationError(400, "REQ_FIELD_INVALID", `${key} must be bounded text.`);
      notes[key] = value;
    }
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (!["day", "week", "month"].includes(period) || !validDate(periodStart) || !validDate(periodEnd) ||
      periodEnd < periodStart || (period === "day" && periodStart !== periodEnd))
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Review window is invalid.");
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const plan = options.planId ? await this.repository.getPlan(owner, options.planId) : undefined;
    if (options.planId && (!plan || plan.goalId !== goalId))
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found for this goal.");
    if (plan && (plan.periodStart !== periodStart || plan.periodEnd !== periodEnd))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Whole-plan review must use the plan dates.");
    const timezone = (await this.repository.getProfile(owner))?.timezone ?? "UTC";
    const tasks = (await this.repository.listTasks(owner)).filter(task => task.goalId === goalId && (!plan || task.planId === plan.id));
    const taskIds = new Set(tasks.map(task => task.id));
    // Broad UTC bounds include every local date across DST and all supported UTC offsets.
    const from = new Date(Date.parse(periodStart) - 2 * 86400000).toISOString();
    const to = new Date(Date.parse(periodEnd) + 3 * 86400000).toISOString();
    const events = (await this.repository.listExecutionEvents(owner, from, to)).filter(event => {
      if (event.aggregateType !== "task" || !taskIds.has(event.aggregateId) ||
        !(event.eventType === "task_start" || terminalTaskEvents.has(event.eventType) || progressTaskEvents.has(event.eventType))) return false;
      const date = businessDateAt(new Date(event.occurredAt), timezone);
      return date >= periodStart && date <= periodEnd;
    }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.aggregateId.localeCompare(b.aggregateId) ||
      a.aggregateVersion - b.aggregateVersion || a.id.localeCompare(b.id));
    const eventIds = events.map(event => event.id);
    // Reuse only an undecided revision with the same execution facts.
    const existing = (await this.repository.listReviews(owner)).find(review => review.goalId === goalId &&
      review.period === period && review.periodStart === periodStart && review.periodEnd === periodEnd &&
      !options.fresh && JSON.stringify(review.output.user_notes ?? {}) === JSON.stringify(notes) && !review.output.action_state && (review.facts.plan_id ?? undefined) === options.planId && review.facts.timezone === timezone &&
      JSON.stringify(review.facts.source_event_ids) === JSON.stringify(eventIds));
    if (existing) return existing;
    const counts = Object.fromEntries([...new Set(events.map(event => event.eventType))]
      .map(type => [type, events.filter(event => event.eventType === type).length]));
    const timestamp = this.clock().toISOString();
    const terminal = events.filter(event => terminalTaskEvents.has(event.eventType));
    const evidenceTasks = tasks.filter(task => events.some(event => event.aggregateId === task.id)).map(task => {
      const taskEvents = events.filter(event => event.aggregateId === task.id);
      const complete = taskEvents.findLast(event => event.eventType === "task_complete");
      const progress = taskEvents.filter(event => progressTaskEvents.has(event.eventType)).map(progressEvidence);
      return { id: task.id, title: complete?.payload.title ?? task.title, last_event: taskEvents.at(-1)?.eventType,
        actual_minutes: complete?.payload.actual_minutes ?? null,
        estimated_minutes: complete?.payload.estimated_minutes ?? null,
        ...(progress.length ? { progress_events: progress } : {}),
        skip_reasons: taskEvents.filter(event => event.eventType === "task_skip").map(event => event.payload.reason ?? "unknown") };
    });
    // 6.1 学习事实：带课程来源的任务按课节统计完成/跳过；练习结果无检测，明确标 unknown，不推导能力达标。
    const learningTargets = new Map(tasks.filter(task => task.learningTarget).map(task => [task.id, task.learningTarget!]));
    const learningEvidence = evidenceTasks.filter(task => learningTargets.has(task.id));
    const learningFact = learningTargets.size ? { learning: {
      lessons_total: learningTargets.size,
      lessons_completed: learningEvidence.filter(task => task.last_event === "task_complete").length,
      lessons_skipped: learningEvidence.filter(task => task.last_event === "task_skip").length,
      lessons_in_progress: learningEvidence.filter(task => task.last_event !== "task_complete" && task.last_event !== "task_skip").length,
      practice_results: "unknown",
      capability_claim: "none",
    } } : {};
    return await this.repository.saveReview({ ...owner, id: randomId("lighttick_review"), goalId, period,
      status: "ready", periodStart, periodEnd, facts: { timezone, goal_id: goalId, event_count: events.length, event_counts: counts,
        scope: plan ? "plan" : "dates", ...(plan ? { plan_id: plan.id, plan_version: plan.version } : {}),
        planned_tasks: tasks.filter(task => {
          if (plan) return true;
          if (!task.scheduledFor) return false;
          const date = task.scheduledFor.length === 10 ? task.scheduledFor : businessDateAt(new Date(task.scheduledFor), timezone);
          return date >= periodStart && date <= periodEnd;
        }).map(task => ({ id: task.id, title: task.title, plan_id: task.planId, scheduled_for: task.scheduledFor,
          estimated_minutes: task.estimatedMinutes, current_status: task.status })),
        ...learningFact, snapshot_at: timestamp, tasks: evidenceTasks, source_event_ids: eventIds, source_max_aggregate_version: Math.max(0, ...events.map(event => event.aggregateVersion)),
        outcome_status: "unverified" }, output: Object.keys(notes).length ? { user_notes: notes } : {}, dataSufficiency: terminal.length >= (period === "day" ? 1 : 3) ? "sufficient" : "insufficient",
      version: 1, createdAt: timestamp, updatedAt: timestamp });
  }
}

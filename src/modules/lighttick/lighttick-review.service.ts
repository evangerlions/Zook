import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickReviewRow } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { businessDateAt } from "./lighttick-today.service.ts";

export class LightTickReviewService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async create(owner: LightTickOwner, goalId: string, period: "day" | "week" | "month", periodStart: string,
    periodEnd: string): Promise<LightTickReviewRow> {
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (!["day", "week", "month"].includes(period) || !validDate(periodStart) || !validDate(periodEnd) ||
      periodEnd < periodStart || (period === "day" && periodStart !== periodEnd))
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Review window is invalid.");
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const timezone = (await this.repository.getProfile(owner))?.timezone ?? "UTC";
    const tasks = (await this.repository.listTasks(owner)).filter(task => task.goalId === goalId);
    const taskIds = new Set(tasks.map(task => task.id));
    // Broad UTC bounds include every local date across DST and all supported UTC offsets.
    const from = new Date(Date.parse(periodStart) - 2 * 86400000).toISOString();
    const to = new Date(Date.parse(periodEnd) + 3 * 86400000).toISOString();
    const events = (await this.repository.listExecutionEvents(owner, from, to)).filter(event => {
      if (event.aggregateType !== "task" || !taskIds.has(event.aggregateId) ||
        !["task_start", "task_complete", "task_skip", "task_defer", "task_cancel"].includes(event.eventType)) return false;
      const date = businessDateAt(new Date(event.occurredAt), timezone);
      return date >= periodStart && date <= periodEnd;
    }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const eventIds = events.map(event => event.id);
    // Reuse only an undecided revision with the same execution facts.
    const existing = (await this.repository.listReviews(owner)).find(review => review.goalId === goalId &&
      review.period === period && review.periodStart === periodStart && review.periodEnd === periodEnd &&
      !review.output.action_state && review.facts.timezone === timezone &&
      JSON.stringify(review.facts.source_event_ids) === JSON.stringify(eventIds));
    if (existing) return existing;
    const counts = Object.fromEntries([...new Set(events.map(event => event.eventType))]
      .map(type => [type, events.filter(event => event.eventType === type).length]));
    const timestamp = this.clock().toISOString();
    const terminal = events.filter(event => ["task_complete", "task_skip", "task_defer", "task_cancel"].includes(event.eventType));
    const evidenceTasks = tasks.filter(task => events.some(event => event.aggregateId === task.id)).map(task => {
      const taskEvents = events.filter(event => event.aggregateId === task.id);
      const complete = taskEvents.findLast(event => event.eventType === "task_complete");
      return { id: task.id, title: complete?.payload.title ?? task.title, last_event: taskEvents.at(-1)?.eventType,
        actual_minutes: complete?.payload.actual_minutes ?? null,
        estimated_minutes: complete?.payload.estimated_minutes ?? null,
        skip_reasons: taskEvents.filter(event => event.eventType === "task_skip").map(event => event.payload.reason ?? "unknown") };
    });
    return await this.repository.saveReview({ ...owner, id: randomId("lighttick_review"), goalId, period,
      status: "ready", periodStart, periodEnd, facts: { timezone, goal_id: goalId, event_count: events.length, event_counts: counts,
        tasks: evidenceTasks, source_event_ids: eventIds, source_max_aggregate_version: Math.max(0, ...events.map(event => event.aggregateVersion)),
        outcome_status: "unverified" }, output: {}, dataSufficiency: terminal.length >= (period === "day" ? 1 : 3) ? "sufficient" : "insufficient",
      version: 1, createdAt: timestamp, updatedAt: timestamp });
  }
}

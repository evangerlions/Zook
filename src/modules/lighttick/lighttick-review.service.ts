import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickReviewRow } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

export class LightTickReviewService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async create(owner: LightTickOwner, goalId: string, period: "week" | "month", periodStart: string,
    periodEnd: string): Promise<LightTickReviewRow> {
    if (periodEnd < periodStart) throw new ApplicationError(400, "REQ_INVALID_BODY", "Review window is invalid.");
    const existing = (await this.repository.listReviews(owner)).find(review => review.goalId === goalId &&
      review.period === period && review.periodStart === periodStart && review.periodEnd === periodEnd);
    if (existing) return existing;
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const from = `${periodStart}T00:00:00.000Z`; const toDate = new Date(`${periodEnd}T00:00:00.000Z`);
    toDate.setUTCDate(toDate.getUTCDate() + 1); const events = await this.repository.listExecutionEvents(owner, from, toDate.toISOString());
    const counts = Object.fromEntries([...new Set(events.map(event => event.eventType))]
      .map(type => [type, events.filter(event => event.eventType === type).length]));
    const timestamp = this.clock().toISOString();
    return await this.repository.saveReview({ ...owner, id: randomId("lighttick_review"), goalId, period,
      status: "ready", periodStart, periodEnd, facts: { event_count: events.length, event_counts: counts,
        source_event_ids: events.map(event => event.id), source_max_aggregate_version: Math.max(0, ...events.map(event => event.aggregateVersion)) },
      output: {}, dataSufficiency: events.length >= 3 ? "sufficient" : "insufficient",
      version: 1, createdAt: timestamp, updatedAt: timestamp });
  }
}

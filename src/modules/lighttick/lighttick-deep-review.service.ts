import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner, LightTickPlanRow, LightTickReviewRow } from "./lighttick.types.ts";
import { LightTickPlanService, type ProposedTaskInput } from "./lighttick-plan.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { sha256 } from "../../shared/utils.ts";

export type DeepReviewAction = "accept_all" | "accept_partial" | "ignore";

export interface ReviewRecommendation {
  id: string; title: string; detail: string; action: string;
  evidence: Record<string, unknown>; proposedTasks?: ProposedTaskInput[];
}

export interface DeepReviewActionResult {
  review: LightTickReviewRow; action: DeepReviewAction;
  selectedRecommendationIds: string[]; proposedPlan?: LightTickPlanRow;
  recommendations: ReviewRecommendation[];
}

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function taskInputs(value: unknown): ProposedTaskInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tasks = value.flatMap(item => {
    const record = asRecord(item); const title = text(record.title);
    const estimatedMinutes = Number(record.estimated_minutes ?? record.estimatedMinutes ?? 15);
    return title && Number.isInteger(estimatedMinutes) && estimatedMinutes >= 1 && estimatedMinutes <= 1440
      ? [{ title, estimatedMinutes, priority: Number.isInteger(record.priority) ? Number(record.priority) : undefined,
        scheduledFor: text(record.scheduled_for) || undefined }] : [];
  });
  return tasks.length ? tasks : undefined;
}

export function normalizeReviewRecommendations(review: LightTickReviewRow): ReviewRecommendation[] {
  const raw = Array.isArray(review.output.recommendations) ? review.output.recommendations : [];
  return raw.flatMap((item, index) => {
    const record = asRecord(item); const title = text(record.title ?? record.summary ?? record.recommendation ?? item);
    if (!title) return [];
    const detail = text(record.detail ?? record.reason ?? record.explanation ?? title);
    const id = text(record.id) || `review_rec_${sha256(`${review.id}:${index}:${title}`).slice(0, 16)}`;
    return [{ id, title, detail, action: text(record.action) || "adjust_pace",
      evidence: asRecord(record.evidence ?? { review_id: review.id, period: review.period,
        period_start: review.periodStart, period_end: review.periodEnd, data_sufficiency: review.dataSufficiency }),
      proposedTasks: taskInputs(record.proposed_tasks ?? record.proposedTasks) }];
  });
}

/** W13-14 review action closure. A review is a decision surface, not a report. */
export class LightTickDeepReviewService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async actionable(owner: LightTickOwner, reviewId: string) {
    const review = await this.require(owner, reviewId);
    return { review, recommendations: normalizeReviewRecommendations(review),
      actionState: asRecord(review.output.action_state) };
  }

  async apply(owner: LightTickOwner, reviewId: string, action: DeepReviewAction,
    selectedIds: string[] = [], ignoreReason?: string): Promise<DeepReviewActionResult> {
    return await this.repository.transaction(owner, () => this.applyDecision(owner, reviewId, action, selectedIds, ignoreReason));
  }

  private async applyDecision(owner: LightTickOwner, reviewId: string, action: DeepReviewAction,
    selectedIds: string[], ignoreReason?: string): Promise<DeepReviewActionResult> {
    const review = await this.require(owner, reviewId);
    const recommendations = normalizeReviewRecommendations(review);
    const previous = asRecord(review.output.action_state);
    if (previous.status && ["ignored", "proposed", "accepted"].includes(String(previous.status)))
      throw new ApplicationError(409, "LIGHTTICK_REVIEW_ACTION_ALREADY_DECIDED", "Review action was already decided.");
    if (!["accept_all", "accept_partial", "ignore"].includes(action))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Review action is invalid.");
    const allIds = recommendations.map(item => item.id);
    let selectedRecommendationIds: string[] = [];
    if (action === "accept_all") selectedRecommendationIds = allIds;
    if (action === "accept_partial") {
      selectedRecommendationIds = [...new Set(selectedIds)];
      if (!selectedRecommendationIds.length || selectedRecommendationIds.some(id => !allIds.includes(id)))
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "Selected recommendation IDs are invalid.");
    }
    const timestamp = this.clock().toISOString();
    if (action === "ignore") {
      const reason = text(ignoreReason);
      if (reason.length < 2 || reason.length > 500)
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "ignore_reason is required.");
      const saved = await this.saveState(review, { status: "ignored", action, selected_ids: [],
        ignore_reason: reason, decided_at: timestamp }, timestamp);
      return { review: saved, action, selectedRecommendationIds: [], recommendations };
    }
    const selected = recommendations.filter(item => selectedRecommendationIds.includes(item.id));
    const activePlan = (await this.repository.listPlans(owner, review.goalId)).find(plan => plan.status === "active");
    const plan = activePlan ?? { granularity: "week" as const, periodStart: review.periodStart, periodEnd: review.periodEnd };
    const tasks = selected.flatMap(item => item.proposedTasks ?? [{ title: item.title, estimatedMinutes: this.minutesFor(item.action), priority: 10 }]);
    if (!tasks.length) throw new ApplicationError(409, "LIGHTTICK_REVIEW_NO_ACTIONABLE_RECOMMENDATIONS", "Review has no actionable recommendations.");
    const proposedPlan = await new LightTickPlanService(this.repository, this.clock).createProposed(owner, {
      goalId: review.goalId, granularity: plan.granularity, periodStart: plan.periodStart, periodEnd: plan.periodEnd,
      source: `review:${review.id}`, tasks, metadata: { review_id: review.id, recommendation_ids: selectedRecommendationIds,
        evidence: selected.map(item => ({ id: item.id, evidence: item.evidence })) },
    });
    const saved = await this.saveState(review, { status: "proposed", action, selected_ids: selectedRecommendationIds,
      proposed_plan_id: proposedPlan.id, decided_at: timestamp }, timestamp);
    return { review: saved, action, selectedRecommendationIds, proposedPlan, recommendations };
  }

  private minutesFor(action: string): number {
    if (action === "reduce_load" || action === "recovery_day") return 15;
    if (action === "increase_challenge") return 30;
    return 20;
  }
  private async require(owner: LightTickOwner, id: string) {
    const review = (await this.repository.listReviews(owner)).find(item => item.id === id);
    if (!review) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Review was not found.");
    return review;
  }
  private async saveState(review: LightTickReviewRow, actionState: Record<string, unknown>, timestamp: string) {
    return await this.repository.saveReview({ ...review,
      output: { ...review.output, recommendations: normalizeReviewRecommendations(review), action_state: actionState },
      version: review.version + 1, updatedAt: timestamp }, review.version);
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import { LightTickDeepReviewService } from "../../src/modules/lighttick/lighttick-deep-review.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickReviewService } from "../../src/modules/lighttick/lighttick-review.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "user_review_action" };
const now = "2026-09-02T00:00:00.000Z";
const clock = () => new Date(now);

async function makeReview(repository: InMemoryLightTickRepository, recommendations: unknown[]) {
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "准备考试", constraints: {} });
  const review = await new LightTickReviewService(repository, clock).create(owner, goal.id, "month", "2026-08-01", "2026-08-31");
  const saved = await repository.saveReview({ ...review, output: {
    insights: ["完成率下降"], recommendations, data_sufficiency: "sufficient" }, version: review.version + 1, updatedAt: now });
  return { goal, review: saved };
}

test("actionable normalizes review recommendations with stable ids and evidence", async () => {
  const repository = new InMemoryLightTickRepository();
  const { review } = await makeReview(repository, [
    { id: "reduce", title: "减少下周任务", detail: "最近连续受阻", action: "reduce_load",
      evidence: { completed_count: 4 }, proposed_tasks: [{ title: "轻量复习", estimated_minutes: 15 }] },
  ]);
  const result = await new LightTickDeepReviewService(repository, clock).actionable(owner, review.id);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0]!.id, "reduce");
  assert.deepEqual(result.recommendations[0]!.evidence, { completed_count: 4 });
});

test("accept_all creates a proposed plan and records review action state", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal, review } = await makeReview(repository, [
    { id: "reduce", title: "减少下周任务", action: "reduce_load", proposed_tasks: [{ title: "轻量复习", estimated_minutes: 15 }] },
    { id: "recover", title: "安排恢复日", action: "recovery_day" },
  ]);
  const result = await new LightTickDeepReviewService(repository, clock).apply(owner, review.id, "accept_all");
  assert.equal(result.action, "accept_all");
  assert.deepEqual(result.selectedRecommendationIds, ["reduce", "recover"]);
  assert.ok(result.proposedPlan);
  assert.equal(result.proposedPlan!.status, "proposed");
  assert.equal(result.proposedPlan!.goalId, goal.id);
  assert.equal((await repository.listReviews(owner))[0]!.output.action_state.status, "proposed");
});

test("accept_partial only applies selected recommendation ids", async () => {
  const repository = new InMemoryLightTickRepository();
  const { review } = await makeReview(repository, [
    { id: "a", title: "减少任务", action: "reduce_load" },
    { id: "b", title: "增加练习", action: "increase_challenge" },
  ]);
  const result = await new LightTickDeepReviewService(repository, clock).apply(owner, review.id, "accept_partial", ["b"]);
  assert.deepEqual(result.selectedRecommendationIds, ["b"]);
  assert.equal(result.proposedPlan!.proposal.recommendation_ids[0], "b");
  const proposedTasks = result.proposedPlan!.proposal.tasks as any[];
  assert.equal(proposedTasks.length, 1);
  assert.equal(proposedTasks[0]!.title, "增加练习");
});

test("ignore requires a reason and does not create a plan", async () => {
  const repository = new InMemoryLightTickRepository();
  const { review } = await makeReview(repository, [{ id: "a", title: "调整节奏", action: "adjust_pace" }]);
  const service = new LightTickDeepReviewService(repository, clock);
  await assert.rejects(() => service.apply(owner, review.id, "ignore"),
    (error: any) => error.code === "REQ_FIELD_INVALID");
  const result = await service.apply(owner, review.id, "ignore", [], "这周先保持原计划");
  assert.equal(result.review.output.action_state.status, "ignored");
  assert.equal(result.proposedPlan, undefined);
});

test("partial selection rejects unknown or empty ids", async () => {
  const repository = new InMemoryLightTickRepository();
  const { review } = await makeReview(repository, [{ id: "a", title: "调整节奏", action: "adjust_pace" }]);
  const service = new LightTickDeepReviewService(repository, clock);
  await assert.rejects(() => service.apply(owner, review.id, "accept_partial", []),
    (error: any) => error.code === "REQ_FIELD_INVALID");
  await assert.rejects(() => service.apply(owner, review.id, "accept_partial", ["unknown"]),
    (error: any) => error.code === "REQ_FIELD_INVALID");
});

test("an action cannot be applied twice", async () => {
  const repository = new InMemoryLightTickRepository();
  const { review } = await makeReview(repository, [{ id: "a", title: "调整节奏", action: "adjust_pace" }]);
  const service = new LightTickDeepReviewService(repository, clock);
  await service.apply(owner, review.id, "ignore", [], "暂时不改");
  await assert.rejects(() => service.apply(owner, review.id, "ignore", [], "再次忽略"),
    (error: any) => error.code === "LIGHTTICK_REVIEW_ACTION_ALREADY_DECIDED");
});

test("foreign review is rejected by owner scoped repository", async () => {
  const repository = new InMemoryLightTickRepository();
  const { review } = await makeReview(repository, [{ title: "调整节奏" }]);
  await assert.rejects(() => new LightTickDeepReviewService(repository, clock)
    .actionable({ appId: "lighttick", userId: "other" }, review.id),
    (error: any) => error.code === "LIGHTTICK_RESOURCE_NOT_FOUND");
});

import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickReviewService } from "../../src/modules/lighttick/lighttick-review.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const clock = () => new Date("2026-08-20T08:00:00Z");

test("review derives immutable source window facts and is idempotent", async () => {
  const repository = new InMemoryLightTickRepository(); const goals = new LightTickGoalService(repository, clock);
  const goal = await goals.create(owner, { title: "Launch", constraints: {} });
  await goals.update(owner, goal.id, 1, { description: "v2" });
  await goals.update(owner, goal.id, 2, { description: "v3" });
  const service = new LightTickReviewService(repository, clock);
  const review = await service.create(owner, goal.id, "week", "2026-08-18", "2026-08-24");
  assert.equal(review.dataSufficiency, "sufficient");
  assert.equal(review.facts.event_count, 3);
  assert.equal(review.facts.source_max_aggregate_version, 3);
  const duplicate = await service.create(owner, goal.id, "week", "2026-08-18", "2026-08-24");
  assert.equal(duplicate.id, review.id);
  assert.equal((await repository.listReviews(owner)).length, 1);
});

test("review reports insufficient data instead of inventing patterns", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "Launch", constraints: {} });
  const review = await new LightTickReviewService(repository, clock).create(owner, goal.id, "week", "2026-08-18", "2026-08-24");
  assert.equal(review.dataSufficiency, "insufficient");
  assert.deepEqual(review.output, {});
  assert.equal(review.facts.event_count, 1);
});

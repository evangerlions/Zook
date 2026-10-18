import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickReviewService } from "../../src/modules/lighttick/lighttick-review.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const clock = () => new Date("2026-08-20T08:00:00Z");

test("review derives immutable source window facts and is idempotent", async () => {
  const repository = new InMemoryLightTickRepository(); const goals = new LightTickGoalService(repository, clock);
  const goal = await goals.create(owner, { title: "Launch", constraints: {} });
  await goals.update(owner, goal.id, 1, { description: "v2" });
  await goals.update(owner, goal.id, 2, { description: "v3" });
  const plans = new LightTickPlanService(repository, clock);
  const draft = await plans.createProposed(owner, { goalId: goal.id, granularity: "week", source: "manual", periodStart: "2026-08-18", periodEnd: "2026-08-24",
    tasks: [1,2,3].map(i => ({ title: `Write section ${i}`, estimatedMinutes: 10 })) });
  const { tasks } = await plans.confirm(owner, draft.id, draft.version);
  for (const task of tasks) await new LightTickTaskService(repository, clock).command(owner, task.id, 1, { action: "complete" });
  const service = new LightTickReviewService(repository, clock);
  const review = await service.create(owner, goal.id, "week", "2026-08-18", "2026-08-24");
  assert.equal(review.dataSufficiency, "sufficient");
  assert.equal(review.facts.event_count, 3);
  assert.equal(review.facts.source_max_aggregate_version, 2);
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
  assert.equal(review.facts.event_count, 0);
});

test("daily review is sufficient with a single fact but a quiet day stays insufficient", async () => {
  const repository = new InMemoryLightTickRepository();
  const goals = new LightTickGoalService(repository, clock);
  const service = new LightTickReviewService(repository, clock);

  // A single terminal task fact from the day grounds a light-touch reflection.
  const withFact = await goals.create(owner, { title: "有事实的目标", constraints: {} });
  const plans = new LightTickPlanService(repository, clock);
  const draft = await plans.createProposed(owner, { goalId: withFact.id, granularity: "day", source: "manual",
    periodStart: "2026-08-20", periodEnd: "2026-08-20", tasks: [{ title: "完成一项行动", estimatedMinutes: 10 }] });
  const { tasks } = await plans.confirm(owner, draft.id, draft.version);
  await new LightTickTaskService(repository, clock).command(owner, tasks[0]!.id, 1, { action: "complete" });
  const daily = await service.create(owner, withFact.id, "day", "2026-08-20", "2026-08-20");
  assert.equal(daily.period, "day");
  assert.equal(daily.dataSufficiency, "sufficient");

  // A day with zero facts is insufficient (day threshold is independent: ≥1).
  const empty = await goals.create(owner, { title: "无事实的目标", constraints: {} });
  const quiet = await service.create(owner, empty.id, "day", "2026-08-20", "2026-08-20");
  assert.equal(quiet.period, "day");
  assert.equal(quiet.facts.event_count, 0);
  assert.equal(quiet.dataSufficiency, "insufficient");
});

test("goal carries an explicit review cadence with a weekly default fallback", async () => {
  const repository = new InMemoryLightTickRepository();
  const service = new LightTickGoalService(repository, clock);

  const defaulted = await service.create(owner, { title: "默认节奏", constraints: {} });
  assert.equal(defaulted.reviewCadence, undefined);

  const dayFirst = await service.create(owner, {
    title: "日复盘优先", constraints: {}, reviewCadence: { layers: ["day", "week"] },
  });
  assert.deepEqual(dayFirst.reviewCadence, { layers: ["day", "week"] });

  const off = await service.update(owner, dayFirst.id, 1, { reviewCadence: { layers: [] } });
  assert.deepEqual(off.reviewCadence, { layers: [] });
});

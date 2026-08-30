import assert from "node:assert/strict";
import test from "node:test";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTodayService, businessDateAt } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const instant = new Date("2026-08-20T16:30:00Z");

test("Today uses IANA business date, active plan, priority, and remaining duration", async () => {
  const repository = new InMemoryLightTickRepository();
  const onboarding = await new LightTickProfileService(repository, () => instant).submitOnboarding(owner, {
    title: "Launch", currentLevel: "Ready", weeklyAvailableMinutes: 300, pace: "balanced", timezone: "Asia/Shanghai",
  });
  const plans = new LightTickPlanService(repository, () => instant);
  const proposed = await plans.createProposed(owner, { goalId: onboarding.goal.id, granularity: "day",
    periodStart: "2026-08-21", periodEnd: "2026-08-21", source: "template", tasks: [
      { title: "Main", estimatedMinutes: 50, priority: 20, scheduledFor: "2026-08-20T16:00:00Z" },
      { title: "Backup", estimatedMinutes: 30, priority: 10, scheduledFor: "2026-08-21T01:00:00Z" },
      { title: "Tomorrow", estimatedMinutes: 90, priority: 99, scheduledFor: "2026-08-21T16:00:00Z" },
    ] });
  await plans.confirm(owner, proposed.id, 1);
  const today = await new LightTickTodayService(repository, () => instant).get(owner);
  assert.equal(today.businessDate, "2026-08-21");
  assert.equal(today.primaryTask?.title, "Main");
  assert.equal(today.executableTasks.length, 2);
  assert.equal(today.remainingEstimatedMinutes, 80);
  assert.equal(today.planBAvailable, true);
});

test("Today returns documented empty state and preserves timezone boundary", async () => {
  const repository = new InMemoryLightTickRepository();
  const today = await new LightTickTodayService(repository, () => instant).get(owner);
  assert.equal(today.emptyState, "no_active_plan");
  assert.equal(today.businessDate, "2026-08-20");
  assert.equal(businessDateAt(instant, "Asia/Shanghai"), "2026-08-21");
  assert.equal(businessDateAt(instant, "America/Los_Angeles"), "2026-08-20");
});

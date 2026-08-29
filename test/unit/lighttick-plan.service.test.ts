import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const other = { appId: "lighttick", userId: "bob" } as const;
const clock = () => new Date("2026-08-20T08:00:00Z");

test("plan confirmation atomically activates draft goal and materializes tasks", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "Launch", constraints: {} });
  const service = new LightTickPlanService(repository, clock);
  const proposed = await service.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-08-24", periodEnd: "2026-08-30", source: "template",
    tasks: [{ title: "Define scope", estimatedMinutes: 30, priority: 10 },
      { title: "Build slice", estimatedMinutes: 90, scheduledFor: "2026-08-25T01:00:00Z" }] });
  const confirmed = await service.confirm(owner, proposed.id, 1);
  assert.deepEqual([confirmed.plan.status, confirmed.plan.version], ["active", 2]);
  assert.equal((await repository.getGoal(owner, goal.id))?.status, "active");
  assert.equal(confirmed.tasks.length, 2);
  assert.ok(confirmed.tasks.every(task => task.status === "pending" && task.version === 1));
  assert.equal((await repository.listTasks(owner, proposed.id)).length, 2);
});

test("plan proposal enforces ownership and constraints before writes", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "Launch", constraints: {} });
  const service = new LightTickPlanService(repository, clock);
  await assert.rejects(service.createProposed(other, { goalId: goal.id, granularity: "week",
    periodStart: "2026-08-24", periodEnd: "2026-08-30", source: "ai", tasks: [{ title: "x", estimatedMinutes: 10 }] }),
  (error: any) => error.code === "LIGHTTICK_RESOURCE_NOT_FOUND");
  await assert.rejects(service.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-08-24", periodEnd: "2026-08-30", source: "ai", tasks: [] }),
  (error: any) => error.code === "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
});

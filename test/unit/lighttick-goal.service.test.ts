import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const alice = { appId: "lighttick", userId: "alice" } as const;
const bob = { appId: "lighttick", userId: "bob" } as const;
const clock = () => new Date("2026-08-20T08:00:00Z");

test("goal service creates, updates, and applies explicit lifecycle with versions", async () => {
  const repository = new InMemoryLightTickRepository(); const service = new LightTickGoalService(repository, clock);
  const created = await service.create(alice, { title: " Learn Swift ", constraints: { weekly_available_minutes: 180 } });
  assert.equal(created.title, "Learn Swift"); assert.equal(created.version, 1);
  const updated = await service.update(alice, created.id, 1, { description: "Build a native product" });
  assert.equal(updated.version, 2); assert.equal(updated.description, "Build a native product");
  const activated = await repository.saveGoal({ ...updated, status: "active" }, {
    event: { ...alice, id: "activate", aggregateType: "goal", aggregateId: created.id, eventType: "activated",
      aggregateVersion: 3, payload: {}, occurredAt: clock().toISOString(), createdAt: clock().toISOString() },
    change: { ...alice, entityType: "goal", entityId: created.id, entityVersion: 3, operation: "upsert",
      changedAt: clock().toISOString() },
  }, 2);
  const paused = await service.transition(alice, created.id, activated.version, "pause");
  assert.deepEqual([paused.status, paused.version], ["paused", 4]);
  const resumed = await service.transition(alice, created.id, paused.version, "resume");
  assert.deepEqual([resumed.status, resumed.version], ["active", 5]);
  assert.equal((await repository.listExecutionEvents(alice)).length, 5);
});

test("goal service hides foreign ownership and rejects stale or invalid transitions", async () => {
  const repository = new InMemoryLightTickRepository(); const service = new LightTickGoalService(repository, clock);
  const created = await service.create(alice, { title: "Goal", constraints: {} });
  await assert.rejects(service.get(bob, created.id), (error: any) => error.code === "LIGHTTICK_RESOURCE_NOT_FOUND");
  await service.update(alice, created.id, 1, { title: "Updated" });
  await assert.rejects(service.update(alice, created.id, 1, { title: "Stale" }),
    (error: any) => error.code === "LIGHTTICK_VERSION_CONFLICT");
  await assert.rejects(service.transition(alice, created.id, 2, "pause"),
    (error: any) => error.code === "LIGHTTICK_STATE_TRANSITION_INVALID");
});

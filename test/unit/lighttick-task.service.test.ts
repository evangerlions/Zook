import assert from "node:assert/strict";
import test from "node:test";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const now = "2026-08-20T08:00:00.000Z";

async function fixture() {
  const repository = new InMemoryLightTickRepository();
  await repository.saveTask({ ...owner, id: "task_a", goalId: "goal_a", planId: "plan_a", title: "Build",
    status: "pending", priority: 1, estimatedMinutes: 60, version: 1, createdAt: now, updatedAt: now }, {
    event: { ...owner, id: "created", aggregateType: "task", aggregateId: "task_a", eventType: "created",
      aggregateVersion: 1, payload: {}, occurredAt: now, createdAt: now },
    change: { ...owner, entityType: "task", entityId: "task_a", entityVersion: 1, operation: "upsert", changedAt: now },
  });
  return { repository, service: new LightTickTaskService(repository, () => new Date("2026-08-20T09:00:00Z")) };
}

test("task commands atomically persist status, event facts, and change feed", async () => {
  const { repository, service } = await fixture();
  const started = await service.command(owner, "task_a", 1, { action: "start" });
  assert.deepEqual([started.status, started.version, started.startedAt], ["in_progress", 2, "2026-08-20T09:00:00.000Z"]);
  const completed = await service.command(owner, "task_a", 2, { action: "complete", actualMinutes: 55, notes: "Done" });
  assert.deepEqual([completed.status, completed.version, completed.notes], ["completed", 3, "Done"]);
  const events = await repository.listExecutionEvents(owner);
  assert.equal(events.length, 3);
  assert.equal(events.at(-1)?.payload.actual_minutes, 55);
  assert.equal((await repository.pullChanges(owner, 0, 10)).length, 3);
});

test("task commands reject stale versions, invalid durations, and duplicate terminal actions", async () => {
  const { repository, service } = await fixture();
  await service.command(owner, "task_a", 1, { action: "start" });
  await assert.rejects(service.command(owner, "task_a", 1, { action: "complete" }),
    (error: any) => error.code === "LIGHTTICK_VERSION_CONFLICT");
  await assert.rejects(service.command(owner, "task_a", 2, { action: "complete", actualMinutes: 0 }),
    (error: any) => error.code === "REQ_INVALID_BODY");
  await service.command(owner, "task_a", 2, { action: "skip", reason: "blocked" });
  await assert.rejects(service.command(owner, "task_a", 3, { action: "complete" }),
    (error: any) => error.code === "LIGHTTICK_STATE_TRANSITION_INVALID");
  assert.equal((await repository.listExecutionEvents(owner)).length, 3);
});

import assert from "node:assert/strict";
import test from "node:test";
import { LightTickSyncService } from "../../src/modules/lighttick/lighttick-sync.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";

const now = "2026-08-20T00:00:00.000Z"; const clock = () => new Date(now);
const owner: LightTickOwner = { appId: "lighttick", userId: "sync_alice" };
async function setup() {
  const repository = new InMemoryLightTickRepository(); const goal = await new LightTickGoalService(repository, clock)
    .create(owner, { title: "Sync", constraints: { weekly_available_minutes: 60 } });
  const plans = new LightTickPlanService(repository, clock); const plan = await plans.createProposed(owner, { goalId: goal.id,
    granularity: "week", periodStart: "2026-08-17", periodEnd: "2026-08-23", source: "manual",
    tasks: [{ title: "Offline", estimatedMinutes: 30 }] });
  const task = (await plans.confirm(owner, plan.id, 1)).tasks[0]!;
  return { repository, task, sync: new LightTickSyncService(repository, new LightTickTaskService(repository, clock), "test-secret", clock) };
}
function operation(task: any, overrides: Record<string, unknown> = {}) { return { operation_id: "operation_sync_001", device_id: "device_ios_001",
  entity_type: "task", entity_id: task.id, action: "complete", base_version: task.version,
  client_occurred_at: now, payload: { actual_duration_minutes: 20 }, ...overrides }; }

test("sync push replays lost responses and rejects mismatched payloads", async () => {
  const { sync, task } = await setup(); const first = await sync.push(owner, [operation(task)]);
  assert.equal(first.results[0].status, "accepted");
  const duplicate = await sync.push(owner, [operation(task)]); assert.equal(duplicate.results[0].status, "duplicate");
  const mismatch = await sync.push(owner, [operation(task, { payload: { actual_duration_minutes: 21 } })]);
  assert.equal(mismatch.results[0].status, "rejected"); assert.equal(mismatch.results[0].error_code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
});

test("sync returns per-operation conflicts and supports partial batches", async () => {
  const { sync, task } = await setup(); const batch = await sync.push(owner, [operation(task, { operation_id: "operation_conflict_001", base_version: 99 }),
    operation(task, { operation_id: "operation_rejected_001", action: "delete_database" })]);
  assert.equal(batch.results[0].status, "conflict"); assert.deepEqual(batch.results[0].resolution_actions, ["keep_server", "refresh_and_retry"]);
  assert.equal(batch.results[1].status, "rejected");
});

test("out-of-order clocks do not override server versions and two devices converge", async () => {
  const { sync, task } = await setup();
  const first = await sync.push(owner, [operation(task, { operation_id: "operation_device_a", device_id: "device_a_001",
    client_occurred_at: "2020-01-01T00:00:00Z", payload: { actual_duration_minutes: 20, note: "kept as event fact" } })]);
  assert.equal(first.results[0].status, "accepted");
  const second = await sync.push(owner, [operation(task, { operation_id: "operation_device_b", device_id: "device_b_001", action: "skip",
    client_occurred_at: "2030-01-01T00:00:00Z", payload: { reason_code: "no_time" } })]);
  assert.equal(second.results[0].status, "conflict"); assert.equal(second.results[0].version, 2);
});

test("logical delete retains audit state and emits a pull tombstone", async () => {
  const { sync, task } = await setup();
  const deleted = await sync.push(owner, [operation(task, { operation_id: "operation_delete_001", action: "delete", payload: {} })]);
  assert.equal(deleted.results[0].status, "accepted");
  const pulled = await sync.pull(owner, undefined, 20);
  const tombstone = pulled.changes.find(change => change.entity_id === task.id && change.operation === "delete");
  assert.ok(tombstone); assert.equal(tombstone?.snapshot, undefined);
});

test("sync pull cursor is owner-bound, paginated, and tamper evident", async () => {
  const { sync, task } = await setup(); const first = await sync.pull(owner, undefined, 1);
  assert.equal(first.changes.length, 1); assert.equal(first.has_more, true);
  const second = await sync.pull(owner, first.next_cursor, 10); assert.ok(second.changes.length >= 1);
  await assert.rejects(() => sync.pull({ appId: "lighttick", userId: "sync_bob" }, first.next_cursor, 10),
    (error: any) => error.code === "LIGHTTICK_SYNC_CURSOR_INVALID");
  await assert.rejects(() => sync.pull(owner, `${first.next_cursor}x`, 10), (error: any) => error.code === "LIGHTTICK_SYNC_CURSOR_INVALID");
  void task;
});

import assert from "node:assert/strict";
import test from "node:test";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import type { LightTickAtomicWrite } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickGoalRow } from "../../src/modules/lighttick/lighttick.types.ts";

const owner = { appId: "lighttick", userId: "user_a" } as const;
const now = "2026-08-20T00:00:00.000Z";
const goal = (version = 1, title = "Ship native app"): LightTickGoalRow => ({
  ...owner, id: "goal_a", title, status: "draft", constraints: {}, version,
  createdAt: now, updatedAt: now,
});
const atomic = (version: number): LightTickAtomicWrite => ({
  event: { ...owner, id: `event_${version}`, aggregateType: "goal", aggregateId: "goal_a",
    eventType: "goal_saved", aggregateVersion: version, payload: {}, occurredAt: now, createdAt: now },
  change: { ...owner, entityType: "goal", entityId: "goal_a", entityVersion: version,
    operation: "upsert", snapshot: { title: "Ship native app" }, changedAt: now },
});

test("in-memory LightTick repository matches atomic version and owner semantics", async () => {
  const repository = new InMemoryLightTickRepository();
  const created = await repository.saveGoal(goal(), atomic(1));
  assert.equal(created.version, 1);
  const updated = await repository.saveGoal(goal(1, "Ship v1"), atomic(2), 1);
  assert.equal(updated.version, 2);
  assert.equal((await repository.listExecutionEvents(owner)).length, 2);
  assert.equal((await repository.pullChanges(owner, 0, 10)).length, 2);

  await assert.rejects(repository.saveGoal(goal(1, "stale"), atomic(2), 1), (error: any) => {
    assert.equal(error.code, "LIGHTTICK_VERSION_CONFLICT"); return true;
  });
  assert.equal((await repository.getGoal(owner, "goal_a"))?.title, "Ship v1");
  assert.equal((await repository.listExecutionEvents(owner)).length, 2);
  assert.equal(await repository.getGoal({ appId: "lighttick", userId: "user_b" }, "goal_a"), undefined);
});

test("PostgreSQL LightTick aggregate write uses one transaction and owner-scoped CAS", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let returnUpdatedRow = true;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
      if (sql.includes("INSERT INTO zook_lighttick_goals") || (sql.includes("UPDATE zook_lighttick_goals") && returnUpdatedRow)) {
        return { rows: [{ id: "goal_a", app_id: "lighttick", user_id: "user_a", title: "Ship native app",
          description: null, status: "draft", constraints: {}, target_date: null, version: sql.includes("UPDATE") ? 2 : 1,
          created_at: new Date(now), updated_at: new Date(now) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const connector = { ...client, async connect() { return client; } };
  const repository = new PostgresLightTickRepository(connector);

  await repository.saveGoal(goal(), atomic(1));
  assert.equal(calls[0]?.sql, "BEGIN");
  assert.match(calls[1]?.sql ?? "", /INSERT INTO zook_lighttick_goals/);
  assert.deepEqual(calls[1]?.values.slice(0, 3), ["goal_a", "lighttick", "user_a"]);
  assert.match(calls[2]?.sql ?? "", /zook_lighttick_execution_events/);
  assert.match(calls[3]?.sql ?? "", /zook_lighttick_change_log/);
  assert.equal(calls[4]?.sql, "COMMIT");

  calls.length = 0; returnUpdatedRow = false;
  await assert.rejects(repository.saveGoal(goal(), atomic(2), 99), (error: any) => {
    assert.equal(error.code, "LIGHTTICK_VERSION_CONFLICT"); return true;
  });
  const update = calls.find(call => call.sql.startsWith("UPDATE zook_lighttick_goals"));
  assert.match(update?.sql ?? "", /WHERE app_id=\$\d+ AND user_id=\$\d+ AND id=\$\d+ AND version=\$\d+/);
  assert.deepEqual(update?.values.slice(-4), ["lighttick", "user_a", "goal_a", 99]);
  assert.equal(calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(calls.some(call => call.sql.includes("execution_events")), false);
});

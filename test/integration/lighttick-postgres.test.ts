import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import type { LightTickAtomicWrite } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickGoalRow } from "../../src/modules/lighttick/lighttick.types.ts";

const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("LIGHTTICK_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");
const owner = { appId: "lighttick", userId: "lighttick_pg_user" } as const;
const now = "2026-08-20T00:00:00.000Z";
const goal = (title: string): LightTickGoalRow => ({ ...owner, id: "lighttick_pg_goal", title,
  status: "active", constraints: {}, version: 1, createdAt: now, updatedAt: now });
const write = (suffix: string, version: number): LightTickAtomicWrite => ({
  event: { ...owner, id: `lighttick_pg_event_${suffix}`, aggregateType: "goal", aggregateId: "lighttick_pg_goal",
    eventType: "goal_updated", aggregateVersion: version, payload: {}, occurredAt: now, createdAt: now },
  change: { ...owner, entityType: "goal", entityId: "lighttick_pg_goal", entityVersion: version,
    operation: "upsert", snapshot: { suffix }, changedAt: now },
});

test("LightTick PostgreSQL migrations, ownership indexes, transactions, and concurrent CAS", async (suite) => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const repository = new PostgresLightTickRepository(pool);
  try {
    await pool.query("DELETE FROM zook_lighttick_execution_events WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_change_log WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_goals WHERE user_id=$1", [owner.userId]);
    await pool.query("DELETE FROM zook_lighttick_profiles WHERE user_id=$1", [owner.userId]);

    await suite.test("installs from empty and remains upgrade/idempotency safe", async () => {
      const installed = await pool.query(`SELECT name FROM zook_schema_migrations
        WHERE name LIKE '029_lighttick%' OR name LIKE '030_lighttick%' OR name LIKE '031_lighttick%'
          OR name LIKE '032_lighttick%' ORDER BY name`);
      assert.deepEqual(installed.rows.map(row => row.name), [
        "029_lighttick_core.sql", "030_lighttick_events_reviews_ai.sql", "031_lighttick_sync_devices.sql",
        "032_lighttick_progressive_action_loop.sql",
      ]);
      const before = installed.rows.length;
      await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
      const after = await pool.query(`SELECT COUNT(*)::int AS count FROM zook_schema_migrations
        WHERE name LIKE '%lighttick%'`);
      assert.equal(after.rows[0].count, before);
    });

    await suite.test("creates owner and sync indexes", async () => {
      const indexes = await pool.query(`SELECT indexname,indexdef FROM pg_indexes
        WHERE schemaname=current_schema() AND indexname LIKE 'zook_lighttick_%'`);
      const definitions = indexes.rows.map(row => row.indexdef).join("\n");
      assert.match(definitions, /app_id, user_id/);
      assert.match(definitions, /zook_lighttick_changes_owner_sequence_idx/);
      assert.match(definitions, /zook_lighttick_operations_pkey/);
      assert.match(definitions, /zook_lighttick_devices_active_token_uidx/);
      assert.match(definitions, /zook_lighttick_tasks_owner_lineage_idx/);
    });

    await suite.test("rolls back failed owner transactions", async () => {
      await assert.rejects(repository.transaction(owner, async () => {
        await repository.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
          onboardingState: "drafting", notificationPreferences: {}, onboardingDraft: {}, version: 1,
          createdAt: now, updatedAt: now });
        throw new Error("force rollback");
      }), /force rollback/);
      assert.equal(await repository.getProfile(owner), undefined);
    });

    await suite.test("allows exactly one concurrent update for one base version", async () => {
      await repository.saveGoal(goal("base"), write("create", 1));
      const outcomes = await Promise.allSettled([
        repository.saveGoal(goal("left"), write("left", 2), 1),
        repository.saveGoal(goal("right"), write("right", 2), 1),
      ]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      const rejected = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "LIGHTTICK_VERSION_CONFLICT");
      const stored = await repository.getGoal(owner, "lighttick_pg_goal");
      assert.equal(stored?.version, 2);
      const events = await pool.query(`SELECT id FROM zook_lighttick_execution_events
        WHERE app_id=$1 AND user_id=$2 AND aggregate_id='lighttick_pg_goal'`, [owner.appId,owner.userId]);
      assert.equal(events.rowCount, 2);
    });
  } finally {
    await pool.query("DELETE FROM zook_lighttick_execution_events WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_change_log WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_goals WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.query("DELETE FROM zook_lighttick_profiles WHERE user_id=$1", [owner.userId]).catch(() => undefined);
    await pool.end();
  }
});

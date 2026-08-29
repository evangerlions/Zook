import assert from "node:assert/strict";
import test from "node:test";
import { deletePostgresAppUserRuntimeData } from "../../src/infrastructure/database/postgres/postgres-app-user-delete.ts";
import { deletePostgresApp } from "../../src/infrastructure/database/postgres/postgres-app-delete.ts";

test("Postgres app-user runtime deletion removes account-owned records", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];

  await deletePostgresAppUserRuntimeData(
    async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
    "ai_novel",
    "user_alice",
  );

  assert.ok(
    queries.some((query) =>
      query.sql === "DELETE FROM zook_ai_novel_daily_statistics WHERE app_id = $1 AND user_id = $2"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql === "DELETE FROM zook_ai_novel_statistics_snapshots WHERE app_id = $1 AND user_id = $2"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql === "DELETE FROM zook_feedback_attachments WHERE app_id = $1 AND user_id = $2"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql === "DELETE FROM zook_feedback WHERE app_id = $1 AND user_id = $2"
    ),
  );
  assert.deepEqual(
    queries.find((query) => query.sql.startsWith("DELETE FROM zook_feedback "))?.values,
    ["ai_novel", "user_alice"],
  );
  assert.equal(queries.some((query) => query.sql.includes("zook_frogsleep_")), false);
});

test("Postgres app-user runtime deletion removes FrogSleep app-scoped runtime records", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];

  await deletePostgresAppUserRuntimeData(
    async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [] };
    },
    "frogsleep",
    "user_alice",
  );

  assert.ok(
    queries.some((query) =>
      query.sql === "DELETE FROM zook_frogsleep_devices WHERE app_id = $1 AND user_id = $2"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql ===
        "DELETE FROM zook_frogsleep_sleep_invites WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql ===
        "DELETE FROM zook_frogsleep_focus_sessions WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql ===
        "DELETE FROM zook_frogsleep_focus_match_feedback WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql ===
        "DELETE FROM zook_frogsleep_sleep_report_snapshots WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql ===
        "DELETE FROM zook_frogsleep_progress_snapshots WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)"
    ),
  );
  assert.ok(
    queries.some((query) =>
      query.sql ===
        "DELETE FROM zook_frogsleep_entitlement_records WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)"
    ),
  );
  assert.deepEqual(
    queries.find((query) => query.sql.startsWith("DELETE FROM zook_frogsleep_devices"))?.values,
    ["frogsleep", "user_alice"],
  );
});

test("Postgres app-user runtime deletion removes every LightTick owner table only for LightTick", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  await deletePostgresAppUserRuntimeData(async (sql, values) => {
    queries.push({ sql, values }); return { rows: [] };
  }, "lighttick", "user_alice");

  const lightTickDeletes = queries.filter(query => query.sql.startsWith("DELETE FROM zook_lighttick_"));
  assert.equal(lightTickDeletes.length, 15);
  assert.ok(lightTickDeletes.some(query => query.sql.startsWith("DELETE FROM zook_lighttick_change_proposals")));
  assert.ok(lightTickDeletes.some(query => query.sql.startsWith("DELETE FROM zook_lighttick_devices")));
  assert.ok(lightTickDeletes.some(query => query.sql.startsWith("DELETE FROM zook_lighttick_operations")));
  assert.ok(lightTickDeletes.some(query => query.sql.startsWith("DELETE FROM zook_lighttick_guest_identities")));
  assert.ok(lightTickDeletes.some(query => query.sql === "DELETE FROM zook_lighttick_account_upgrades WHERE app_id = $1 AND (guest_user_id = $2 OR target_user_id = $2)"));
  assert.ok(lightTickDeletes.every(query => query.sql.includes("app_id = $1") && (query.sql.includes("user_id = $2")
    || query.sql.includes("guest_user_id = $2 OR target_user_id = $2"))));
  assert.ok(lightTickDeletes.every(query => JSON.stringify(query.values) === JSON.stringify(["lighttick", "user_alice"])));
  assert.equal(queries.some(query => query.sql.includes("zook_frogsleep_")), false);
});

test("Postgres app deletion includes all LightTick product tables", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  await deletePostgresApp(async (sql, values) => {
    queries.push({ sql, values });
    return { rows: sql.startsWith("SELECT id FROM zook_roles") ? [{ id: "role_lighttick_member" }] : [] };
  }, "lighttick");
  const lightTickDeletes = queries.filter(query => query.sql.startsWith("DELETE FROM zook_lighttick_"));
  assert.equal(lightTickDeletes.length, 15);
  assert.ok(lightTickDeletes.some(query => query.sql.startsWith("DELETE FROM zook_lighttick_account_upgrades")));
  assert.ok(lightTickDeletes.every(query => JSON.stringify(query.values) === JSON.stringify(["lighttick"])));
  assert.equal(queries.at(-1)?.sql, "DELETE FROM zook_apps WHERE id = $1");
});

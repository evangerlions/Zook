import assert from "node:assert/strict";
import test from "node:test";
import { deletePostgresAppUserRuntimeData } from "../../src/infrastructure/database/postgres/postgres-app-user-delete.ts";

test("Postgres app-user runtime deletion removes feedback records and attachments", async () => {
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
  assert.deepEqual(
    queries.find((query) => query.sql.startsWith("DELETE FROM zook_frogsleep_devices"))?.values,
    ["frogsleep", "user_alice"],
  );
});

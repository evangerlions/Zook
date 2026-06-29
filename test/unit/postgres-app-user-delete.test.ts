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
});

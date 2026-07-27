import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";

import { PostgresAppUserStore } from "../../src/infrastructure/database/postgres/postgres-app-users.ts";

function queryResult(rows: QueryResultRow[]): QueryResult<QueryResultRow> {
  return {
    command: "UPDATE",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

test("Postgres account-region finalization lets only the first concrete region win", async () => {
  let storedRegion: "UNKNOWN" | "CN" | "GLOBAL" = "UNKNOWN";
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAppUserStore(async (sql, values) => {
    queries.push({ sql, values });
    if (storedRegion !== "UNKNOWN") {
      return queryResult([]);
    }

    storedRegion = values?.[2] as "CN" | "GLOBAL";
    return queryResult([
      {
        id: "app_user_alice",
        app_id: "ai_novel",
        user_id: "user_alice",
        status: "ACTIVE",
        account_region: storedRegion,
        joined_at: "2026-07-11T00:00:00.000Z",
      },
    ]);
  });

  const results = await Promise.all([
    store.finalizeAccountRegion("ai_novel", "user_alice", "CN"),
    store.finalizeAccountRegion("ai_novel", "user_alice", "GLOBAL"),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(storedRegion, "CN");
  assert.equal(results[0]?.accountRegion, "CN");
  assert.equal(results[1], undefined);
  assert.deepEqual(queries.map((query) => query.values), [
    ["ai_novel", "user_alice", "CN"],
    ["ai_novel", "user_alice", "GLOBAL"],
  ]);
  assert.ok(
    queries.every((query) =>
      query.sql.includes("account_region = 'UNKNOWN'")
    ),
  );
});

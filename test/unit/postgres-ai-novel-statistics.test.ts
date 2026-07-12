import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAiNovelStatisticsStore } from "../../src/infrastructure/database/postgres/postgres-ai-novel-statistics.ts";

test("Postgres writing snapshot clears omitted writing fields and preserves tokens", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const store = new PostgresAiNovelStatisticsStore(async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [] };
  });

  await store.replaceDailyWritingStats(
    "ai_novel",
    "user_alice",
    [{
      appId: "ai_novel",
      userId: "user_alice",
      date: "2026-07-02",
      words: 50,
      tokens: 0,
      active: true,
      updatedAt: "2026-07-02T03:00:00.000Z",
    }],
    "2026-07-02T03:00:00.000Z",
  );

  assert.match(queries[0]?.sql ?? "", /SET words = 0, active = FALSE/);
  assert.deepEqual(queries[0]?.values, [
    "ai_novel",
    "user_alice",
    "2026-07-02T03:00:00.000Z",
  ]);
  assert.match(queries[1]?.sql ?? "", /words = EXCLUDED\.words/);
  assert.doesNotMatch(queries[1]?.sql ?? "", /tokens = EXCLUDED\.tokens/);
});

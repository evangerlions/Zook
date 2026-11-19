import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyBillingEnvironmentFixture } from "./support/ainovel-billing-fixture.ts";
import { LOCAL_CREDIT_QUOTAS } from "../../src/modules/ai-novel/credits/ai-novel-credits-model.ts";
import { PostgresAiNovelCreditsStore } from "../../src/infrastructure/database/postgres/postgres-ai-novel-credits.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";

import { searchCreditCharge } from "../../src/modules/ai-novel/search/search-credit-charge.ts";
import { parseSearchInput } from "../../src/modules/ai-novel/search/search-types.ts";

const databaseUrl = process.env.AINOVEL_CREDITS_TEST_DATABASE_URL?.trim();

test("credits PostgreSQL migration, locks, rollback, and exact settlement survive new service instances", { skip: !databaseUrl }, async () => {
  // Never migrate a shared schema: create/drop only this run's random test namespace.
  const schema = `credits_test_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const connect = async () => {
    const client = await pool.connect();
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  };
  try {
    const migration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/072_ai_novel_credits.sql", import.meta.url), "utf8");
    const client = await connect();
    try {
      await client.query(migration); await client.query(migration);
      await client.query(await readFile(new URL("../../src/infrastructure/database/postgres/migrations/075_ai_novel_usage_reporting.sql", import.meta.url), "utf8"));
      await client.query(await readFile(new URL("../../src/infrastructure/database/postgres/migrations/075_ai_novel_usage_reporting.sql", import.meta.url), "utf8"));
      await applyBillingEnvironmentFixture(client);
    } finally { client.release(); }
    const store = new PostgresAiNovelCreditsStore(connect);
    const service = new AiNovelCreditsService(store, async () => "free");
    const contenders = await Promise.allSettled(["a", "b", "c", "d"].map(id => service.begin("user", `job-${id}`, `request-${id}`)));
    assert.equal(contenders.filter((item) => item.status === "fulfilled").length, 3);
    assert.equal(contenders.filter((item) => item.status === "rejected").length, 1);
    const job = "job-a";
    const request = "request-a";
    const receipt = { callId: "receipt", requestId: request, modelKey: "qwen3.6-plus", pointMicros: "1000", usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 }, pricing: { inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 100 } };
    await Promise.all([service.record("user", job, request, receipt), service.record("user", job, request, receipt)]);
    await Promise.all(["b", "c"].map(id => service.record("user", `job-${id}`, `request-${id}`, { ...receipt, callId: `receipt-${id}` })));
    await service.releaseRequest("user", job, request);
    // Immediate debit persisted with the receipt; duplicate callbacks debit once.
    assert.equal((await service.balanceMicros("user")).remainingMicros, String(BigInt(LOCAL_CREDIT_QUOTAS.free) * 1_000_000n - 3000n));
    await assert.rejects(store.transact("user", "rollback", (state) => {
      state.account!.periodicMicros = "0";
      throw Error("intentional transaction rollback");
    }));
    const restarted = new AiNovelCreditsService(new PostgresAiNovelCreditsStore(connect), async () => "free");
    assert.equal((await restarted.balanceMicros("user")).remainingMicros, String(BigInt(LOCAL_CREDIT_QUOTAS.free) * 1_000_000n - 3000n));
    for (const outcome of ["failure", "cancelled"] as const) {
      await restarted.begin("user", outcome, outcome);
      await restarted.closeRequest("user", outcome, outcome, outcome);
    }
    assert.equal((await restarted.balanceMicros("user")).remainingMicros, String(BigInt(LOCAL_CREDIT_QUOTAS.free) * 1_000_000n - 3000n));
    const search = parseSearchInput({ sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: "search-pg", query: "historical reference" });
    const fixed = searchCreditCharge(search, 2);
    const fixedResults = await Promise.all([
      service.settleFixedCharge("search-user", "search-r1", fixed),
      restarted.settleFixedCharge("search-user", "search-r2", fixed),
    ]);
    assert.deepEqual(fixedResults.sort(), ["charged", "replayed"]);
    assert.equal((await restarted.balance("search-user")).remainingPoints, 198);
    await service.balance("search-race");
    await store.transact("search-race", "", state => {
      state.account!.periodicMicros = "2000000";
      state.account!.spentMicros = "198000000";
    });
    const race = await Promise.all(["a", "b"].map(id => restarted.settleFixedCharge("search-race", `race-${id}`,
      searchCreditCharge({ ...search, toolCallId: id }, 2))));
    assert.deepEqual(race.sort(), ["charged", "quota_insufficient"]);
    assert.equal((await service.balance("search-race")).remainingPoints, 0);
    const abort = new AbortController();
    const blocker = await connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT * FROM zook_ai_novel_credit_accounts WHERE user_id='search-user' FOR UPDATE");
      const pending = restarted.settleFixedCharge("search-user", "cancelled", searchCreditCharge({ ...search, toolCallId: "cancelled" }, 2), abort.signal);
      const rejection = assert.rejects(pending, /stop-while-waiting/);
      abort.abort(new Error("stop-while-waiting"));
      await blocker.query("COMMIT");
      await rejection;
    } finally { blocker.release(); }
    assert.equal((await service.balance("search-user")).remainingPoints, 198);
    const reader = await connect();
    try {
      const count = await reader.query("SELECT count(*) AS n FROM zook_ai_novel_credit_events WHERE user_id='search-user' AND payload->>'source'='web_search'");
      assert.equal(Number(count.rows[0].n), 1);
    } finally { reader.release(); }
    console.log(JSON.stringify({ evidence: "credits-postgres", schema, migration: "072", isolation: "random schema", concurrency: "4 contenders / 3 admitted", persistedMicros: String(BigInt(LOCAL_CREDIT_QUOTAS.free) * 1_000_000n - 3000n) }));
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

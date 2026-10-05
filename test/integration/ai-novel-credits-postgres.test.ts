import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresAiNovelCreditsStore } from "../../src/infrastructure/database/postgres/postgres-ai-novel-credits.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";

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
    try { await client.query(migration); await client.query(migration); } finally { client.release(); }
    const store = new PostgresAiNovelCreditsStore(connect);
    const service = new AiNovelCreditsService(store, async () => "free");
    const contenders = await Promise.allSettled([service.begin("user", "job-a", "request-a"), service.begin("user", "job-b", "request-b")]);
    assert.equal(contenders.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(contenders.filter((item) => item.status === "rejected").length, 1);
    const winningA = contenders[0].status === "fulfilled";
    const job = winningA ? "job-a" : "job-b";
    const request = winningA ? "request-a" : "request-b";
    const receipt = { callId: "receipt", requestId: request, modelKey: "qwen3.6-plus", pointMicros: "1000", usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 }, pricing: { inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 100 } };
    await Promise.all([service.record("user", job, request, receipt), service.record("user", job, request, receipt)]);
    await service.releaseRequest("user", job, request);
    // Immediate debit persisted with the receipt; duplicate callbacks debit once.
    assert.equal((await service.balanceMicros("user")).remainingMicros, "19999000");
    await assert.rejects(store.transact("user", "rollback", (state) => {
      state.account!.periodicMicros = "0";
      throw Error("intentional transaction rollback");
    }));
    const restarted = new AiNovelCreditsService(new PostgresAiNovelCreditsStore(connect), async () => "free");
    assert.equal((await restarted.balanceMicros("user")).remainingMicros, "19999000");
    for (const outcome of ["failure", "cancelled"] as const) {
      await restarted.begin("user", outcome, outcome);
      await restarted.closeRequest("user", outcome, outcome, outcome);
    }
    assert.equal((await restarted.balanceMicros("user")).remainingMicros, "19999000");
    console.log(JSON.stringify({ evidence: "credits-postgres", schema, migration: "072", isolation: "random schema", concurrency: "2 contenders / 1 admitted", persistedMicros: "19999000" }));
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

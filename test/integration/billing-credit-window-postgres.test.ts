import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PostgresAiNovelBillingStore } from "../../src/infrastructure/database/postgres/postgres-ainovel-billing.ts";
import type { AiNovelBillingMembershipRecord } from "../../src/shared/types/ainovel-billing.ts";

const databaseUrl = process.env.AINOVEL_CREDITS_TEST_DATABASE_URL;
test("billing credit anchor migration is idempotent and persists across connections", { skip: !databaseUrl }, async () => {
  const schema = `credit_anchor_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    const base = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/067_ai_novel_billing_revenuecat.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/074_ai_novel_credit_window_anchor.sql", import.meta.url), "utf8");
    await client.query(base);
    await client.query(migration);
    await client.query(migration);
    const store = new PostgresAiNovelBillingStore((sql, values) => client.query(sql, values));
    const record: AiNovelBillingMembershipRecord = { appId: "ai_novel", userId: "u", active: true, state: "active",
      tier: "plus", planKey: "plus_monthly", expiresAt: "2026-11-06T15:00:00Z", autoRenew: true, source: "app_store",
      managementUrl: null, lastSyncedAt: "2026-10-06T15:00:00Z", accountDeletedAt: null, creditWindowAnchorAt: "2026-10-06T14:00:00Z" };
    await store.upsertMembership(record);
    const restarted = new PostgresAiNovelBillingStore((sql, values) => client.query(sql, values));
    assert.equal((await restarted.findMembership("ai_novel", "u"))?.creditWindowAnchorAt, "2026-10-06T14:00:00.000Z");
    await restarted.upsertMembership({ ...record, tier: "pro", expiresAt: "2026-12-06T15:00:00Z", lastSyncedAt: "2026-10-07T00:00:00Z" });
    await store.upsertMembership({ ...record, creditWindowAnchorAt: undefined });
    const current = await restarted.findMembership("ai_novel", "u");
    assert.equal(current?.tier, "pro");
    assert.equal(current?.creditWindowAnchorAt, "2026-10-06T14:00:00.000Z");
  } finally {
    client.release();
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});

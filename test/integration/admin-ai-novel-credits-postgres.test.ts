import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { applyBillingEnvironmentFixture } from "./support/ainovel-billing-fixture.ts";
import { PostgresAiNovelCreditsStore } from "../../src/infrastructure/database/postgres/postgres-ai-novel-credits.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { searchCreditUsers } from "../../src/modules/ai-novel/credits/admin-credit-search.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

const url = process.env.AINOVEL_CREDITS_TEST_DATABASE_URL?.trim();
test("Postgres grant ledger is atomic, globally idempotent, environment isolated and searches literally", { skip: !url }, async () => {
  const schema = `credits_admin_${randomBytes(8).toString("hex")}`;
  const pool = new Pool({ connectionString: url });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const connect = async () => { const client = await pool.connect(); await client.query(`SET search_path TO "${schema}"`); return client; };
  try {
    const client = await connect();
    try {
      await applyBillingEnvironmentFixture(client);
      await client.query(await readFile(new URL("../../src/infrastructure/database/postgres/migrations/085_ai_novel_admin_credit_grant_idempotency.sql", import.meta.url), "utf8"));
      await client.query("CREATE TABLE zook_users(id text primary key, email text, phone text)");
      for (let i = 0; i < 11; i++) await client.query("INSERT INTO zook_users VALUES($1,$2,$3)", [`user_${i}`, `email${i}@example.com`, `555${i}`]);
    } finally { client.release(); }
    const store = new PostgresAiNovelCreditsStore(connect);
    const service = new AiNovelCreditsService(store, async () => "free", undefined, () => new Date("2026-11-05T00:00:00Z"));
    for (const [field, term] of [["uid", "user_"], ["phone", "555"], ["email", "email"]] as const) {
      assert.deepEqual(await searchCreditUsers(store, field, term), { tooMany: true, users: [] });
    }
    const update = await connect();
    try { await update.query("UPDATE zook_users SET id='other_10', phone='99910', email='other10@example.com' WHERE id='user_10'"); }
    finally { update.release(); }
    for (const [field, term] of [["uid", "user_"], ["phone", "555"], ["email", "email"]] as const) {
      const matches = await searchCreditUsers(store, field, term);
      assert.equal(matches.tooMany, false); assert.equal(matches.users.length, 10);
    }

    assert.equal((await searchCreditUsers(store, "email", "email1@")).users[0]?.uid, "user_1");
    assert.equal((await searchCreditUsers(store, "phone", "5551")).users.length, 1);
    assert.equal((await searchCreditUsers(store, "uid", "%")).users.length, 0);
    await Promise.all([service.grant("user_1", "once", 12, "admin"), service.grant("user_1", "once", 12, "admin")]);
    await assert.rejects(service.grant("user_2", "once", 12, "admin"), (error: unknown) => {
      assert.equal((error as { statusCode: number }).statusCode, 409);
      assert.equal((error as { code: string }).code, "AINOVEL_CREDITS_JOB_CONFLICT");
      return true;
    });
    const initialRecords = await store.listAdminGrants(0, 50);
    assert.equal(initialRecords.length, 1); assert.equal(initialRecords[0]?.uid, "user_1");
    const account = await store.transact("user_1", "", state => structuredClone(state.account!));
    assert.equal(account.giftMicros, "12000000"); assert.equal(account.deferredStart, true);
    const absent = await store.transact("user_2", "", state => state.account);
    assert.equal(absent, undefined);
    await inBillingEnvironment("sandbox", () => service.grant("user_2", "once", 3, "admin"));
    assert.equal((await store.listAdminGrants(0, 50)).length, 1);
    assert.equal((await inBillingEnvironment("sandbox", () => store.listAdminGrants(0, 50))).length, 1);
    const broken = await connect();
    try { await broken.query("ALTER TABLE zook_ai_novel_credit_events ADD CONSTRAINT reject_test CHECK (event_id <> 'gift:reject')"); } finally { broken.release(); }
    await assert.rejects(service.grant("user_1", "reject", 5, "admin"));
    const after = await store.transact("user_1", "", state => state.account!);
    assert.equal(after.giftMicros, "12000000");
    assert.equal((await store.listAdminGrants(0, 50)).length, 1);
    const race = await Promise.allSettled([
      service.grant("user_1", "race-key", 1, "admin"),
      service.grant("user_2", "race-key", 1, "admin"),
    ]);
    assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(race.filter(result => result.status === "rejected").length, 1);
    for (let i = 0; i < 49; i++) await service.grant("user_1", `page-${i}`, 1, "admin");
    assert.equal((await store.listAdminGrants(0, 50)).length, 50);
    assert.equal((await store.listAdminGrants(50, 50)).length, 1);
  } finally { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); }
});

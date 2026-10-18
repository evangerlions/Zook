import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { FrogSleepProductDataService } from "../../src/modules/frogsleep/product-data/frogsleep-product-data.service.ts";
import { FrogSleepFocusBuddyService } from "../../src/modules/frogsleep/focus-buddy/focus-buddy.service.ts";
import { BuddyDomainInvitationCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-command.service.ts";
import { createApplication } from "../../src/app.module.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL?.trim();
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must reference a disposable PostgreSQL database.");
const now = () => new Date().toISOString();
const focus = { session_id: "account-data-focus", started_at: "2026-10-15T23:50:00Z",
  ended_at: "2026-10-16T00:10:00Z", actual_minutes: 20, status: "completed" };
const report = { snapshot_id: "account-data-report", recorded_at: "2026-10-16T08:00:00Z",
  date_anchor: "2026-10-16", schema_version: "1", data: { sleep_minutes: 420 } };

async function seedInvitation(db: PostgresDatabase) {
  await db.upsertFrogSleepBuddyInvitationBundle({ id: "account-data-invitation", appId: "frogsleep",
    inviterUserId: "user_alice", inviteeUserId: "user_bob", domains: ["sleep", "focus"],
    status: "pending", version: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    shareCode: "ACCDATA1", handoffToken: "account-data-token", shareLink: "https://example.com/invitation",
    locale: "en", domainInvitationIds: {}, domainErrorCodes: {}, createdAt: now(), updatedAt: now() });
  for (const domain of ["sleep", "focus"] as const) await db.upsertFrogSleepBuddyInvitationDomainDecision({
    appId: "frogsleep", invitationId: "account-data-invitation", domain, status: "pending",
    version: 1, createdAt: now(), updatedAt: now() });
}

test("live PostgreSQL account ownership and deletion gate", async suite => {
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const first = await PostgresDatabase.create(url!, seed);
  const second = await PostgresDatabase.create(url!, seed);
  const sql = new Client({ connectionString: url });
  await sql.connect();
  const runtime = await createApplication({ database: first, frogsleepEnabled: true, queueBackend: "memory" });
  try {
    await runtime.services.authService.login({ appId: "frogsleep", account: "alice@example.com",
      password: "Password1234", clientType: "app" });
    await runtime.services.authService.login({ appId: "frogsleep", account: "bob@example.com",
      password: "Password1234", clientType: "app" });

    await suite.test("two connections replay completed focus/report uploads once", async () => {
      const focusServices = [first, second].map(db => new FrogSleepFocusBuddyService(db));
      const reports = [first, second].map(db => new FrogSleepProductDataService(db));
      const sessions = await Promise.all(Array.from({ length: 8 }, (_, i) => focusServices[i % 2].reportSession("user_alice", focus)));
      assert.equal(new Set(sessions.map(item => item.id)).size, 1);
      const snapshots = await Promise.all(Array.from({ length: 8 }, (_, i) => reports[i % 2].createSleepReport("user_alice", report)));
      assert.equal(new Set(snapshots.map(item => item.id)).size, 1);
      const rows = await sql.query(`SELECT count(*)::int AS count FROM zook_frogsleep_focus_sessions
        WHERE owner_user_id='user_alice' AND payload->>'client_session_id'=$1`, [focus.session_id]);
      assert.equal(rows.rows[0].count, 1);
      await assert.rejects(reports[1].createSleepReport("user_alice", { ...report, data: { sleep_minutes: 9 } }),
        (error: any) => error.statusCode === 409);
      const other = await reports[1].createSleepReport("user_bob", report);
      assert.notEqual(other.id, snapshots[0].id);
    });

    await suite.test("legacy IDs beyond the list page still replay without duplicating", async () => {
      await first.insertFrogSleepEntity({ id: "account-data-old-report", appId: "frogsleep",
        kind: "sleep_report_snapshot", ownerUserId: "user_alice", status: "active",
        occurredAt: "2026-10-16T08:00:00.000Z", payload: { ...report, recorded_at: "2026-10-16T08:00:00.000Z", snapshot_id: "old-report",
          report_id: "old-report", report_type: "sleep_report" }, createdAt: now(), updatedAt: now() });
      await sql.query(`INSERT INTO zook_frogsleep_sleep_report_snapshots
        (id,app_id,owner_user_id,status,payload,occurred_at,created_at,updated_at)
        SELECT 'account-data-page-' || n,'frogsleep','user_alice','active','{}'::jsonb,
        '2026-10-17T08:00:00Z'::timestamptz,NOW(),NOW() FROM generate_series(1,501) AS n`);
      const saved = await new FrogSleepProductDataService(second).createSleepReport("user_alice", {
        ...report, snapshot_id: "old-report" });
      assert.equal(saved.id, "account-data-old-report");
    });

    await seedInvitation(first);
    const original = (await first.findFrogSleepBuddyInvitationBundle("frogsleep", "account-data-invitation"))!;
    await first.upsertFrogSleepBuddyInvitationBundle({ ...original, id: "email-only-invitation",
      inviterUserId: "user_bob", inviteeUserId: undefined, recipientEmail: "alice@example.com",
      shareCode: "EMAILON1", handoffToken: "email-only-token" });
    const commands = new BuddyDomainInvitationCommandService(second);
    const accepted = await commands.accept("user_bob", "account-data-invitation", "sleep",
      { expectedVersion: 1, idempotencyKey: "account-data-sleep" });

    await suite.test("delete failure rolls back data, grants and membership", async () => {
      await sql.query(`CREATE FUNCTION account_data_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected deletion failure'; END $$`);
      await sql.query(`CREATE TRIGGER account_data_reject_delete BEFORE DELETE ON zook_frogsleep_buddy_domain_relationships
        FOR EACH ROW EXECUTE FUNCTION account_data_reject_delete()`);
      try {
        await assert.rejects(runtime.services.authService.deleteCurrentAppAccount({ appId: "frogsleep",
          userId: "user_alice", confirmation: "DELETE" }), /injected deletion failure/);
        assert.equal((await second.findAppUser("frogsleep", "user_alice"))?.status, "ACTIVE");
        assert.equal((await second.listFrogSleepBuddySharingGrants("frogsleep", accepted.relationship_id)).length, 8);
        assert.ok(await second.findFrogSleepPersonalRecord("sleep_report_snapshot", "user_alice", report.snapshot_id));
      } finally {
        await sql.query("DROP TRIGGER account_data_reject_delete ON zook_frogsleep_buddy_domain_relationships");
        await sql.query("DROP FUNCTION account_data_reject_delete()");
      }
    });

    await suite.test("delete removes relationships, frees partner slots and preserves global/other-product data", async () => {
      await sql.query(`CREATE FUNCTION account_data_delay_delete() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(0.3); RETURN OLD; END $$`);
      await sql.query(`CREATE TRIGGER account_data_delay_delete BEFORE DELETE ON zook_frogsleep_buddy_domain_relationships
        FOR EACH ROW EXECUTE FUNCTION account_data_delay_delete()`);
      const deletion = runtime.services.authService.deleteCurrentAppAccount({ appId: "frogsleep",
        userId: "user_alice", confirmation: "DELETE" });
      try {
        await waitForDeletingTransaction(sql);
        const late = assert.rejects(new FrogSleepProductDataService(second).createSleepReport("user_alice", {
          ...report, snapshot_id: "late-after-delete" }), (error: any) => error.code === "APP_MEMBER_DELETED");
        const lateAccept = assert.rejects(commands.accept("user_bob", "account-data-invitation", "focus", {
          expectedVersion: 1, idempotencyKey: "late-during-delete" }), (error: any) => error.statusCode === 404);
        const [result] = await Promise.all([deletion, late, lateAccept]);
        assert.equal(result.deleted, true);
        assert.equal(await second.findFrogSleepPersonalRecord("sleep_report_snapshot", "user_alice", "late-after-delete"), undefined);
      } finally {
        await deletion.catch(() => undefined);
        await sql.query("DROP TRIGGER account_data_delay_delete ON zook_frogsleep_buddy_domain_relationships");
        await sql.query("DROP FUNCTION account_data_delay_delete()");
      }
      assert.equal((await second.findUserById("user_alice"))?.status, "ACTIVE");
      assert.equal((await second.findAppUser("app_a", "user_alice"))?.status, "ACTIVE");
      assert.equal((await second.findAppUser("frogsleep", "user_alice"))?.status, "DELETED");
      assert.equal(await second.findFrogSleepBuddyDomainRelationship("frogsleep", accepted.relationship_id), undefined);
      assert.equal((await second.listFrogSleepBuddySharingGrants("frogsleep", accepted.relationship_id)).length, 0);
      assert.equal((await second.findFrogSleepBuddyDomainSlot("frogsleep", "user_bob", "sleep"))?.state, "available");
      assert.equal(await second.findFrogSleepBuddyInvitationBundle("frogsleep", "email-only-invitation"), undefined);
      assert.ok(await second.findFrogSleepPersonalRecord("sleep_report_snapshot", "user_bob", report.snapshot_id));
      await assert.rejects(commands.accept("user_bob", "account-data-invitation", "sleep",
        { expectedVersion: 1, idempotencyKey: "account-data-sleep" }));
      await assert.rejects(new FrogSleepProductDataService(second).createSleepReport("user_alice", report),
        (error: any) => error.code === "APP_MEMBER_DELETED");
    });
  } finally {
    await Promise.all([first.close(), second.close(), sql.end()]);
  }
});

async function waitForDeletingTransaction(sql: Client): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await sql.query(`SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event='PgSleep' LIMIT 1`);
    if (result.rows.length) return;
    await new Promise(done => setTimeout(done, 10));
  }
  throw new Error("Deletion did not reach its deterministic delay barrier.");
}

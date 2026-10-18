import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { NotificationService } from "../../src/services/notification.service.ts";
import { BuddyNotificationWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-worker.service.ts";
import { BuddyInvitationEmailWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-invitation-email-worker.service.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { notificationFixture, notificationDevice } from "../helpers/frogsleep-notification-fixture.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must refer to a disposable database.");
const run = (service: NotificationService, id: string) => service.processQueueJob({ id, name: "notification.send", payload: { notificationJobId: id } });

test("PostgreSQL notification handoff, device receipts, withdrawal, email claims and upgrade", async suite => {
  process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "true"; process.env.FROGSLEEP_BUDDY_EMAIL_ENABLED = "true";
  const a = await PostgresDatabase.create(url, buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const b = await PostgresDatabase.create(url, buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const sql = new Client({ connectionString: url }); await sql.connect();
  const queue = new InMemoryJobQueue(), logger = new StructuredLogger("test", { emitToConsole: false });
  const calls: Record<string, number> = {}; let failing = true;
  const dispatcher = { async dispatch(request: any) { calls[request.pushToken] = (calls[request.pushToken] ?? 0) + 1; if (request.pushToken === "second" && failing) throw new Error("provider down"); } };
  const sa = new NotificationService(a, queue, logger, dispatcher), sb = new NotificationService(b, queue, logger, dispatcher);
  try {
    const pair = await notificationFixture(a, "pg_delivery"); await notificationDevice(a, "first"); await notificationDevice(a, "second");
    await suite.test("two outbox workers share one logical job, channel receipt and feed", async () => {
      await Promise.all([new BuddyNotificationWorkerService(a, sa, undefined, true).processBatch(), new BuddyNotificationWorkerService(b, sb, undefined, true).processBatch()]);
      assert.equal((await sql.query("SELECT count(*)::int AS n FROM zook_notification_jobs WHERE app_id='frogsleep'")).rows[0].n, 1);
      assert.equal((await sql.query("SELECT count(*)::int AS n FROM zook_frogsleep_buddy_notifications")).rows[0].n, 1);
      assert.equal((await sql.query("SELECT count(*)::int AS n FROM zook_frogsleep_buddy_notification_deliveries WHERE channel='in_app'")).rows[0].n, 1);
    });
    const id = String((await sql.query("SELECT id FROM zook_notification_jobs WHERE app_id='frogsleep'")).rows[0].id);
    await suite.test("independent connections retain successful devices on concurrent replay", async () => {
      await run(sa, id); assert.equal((await b.findNotificationJob(id))?.status, "FAILED");
      assert.equal(Object.keys(((await b.findNotificationJob(id))!.payload._frogsleep_delivery as any).devices).length, 1);
      failing = false; await Promise.all([run(sa, id), run(sb, id)]); await run(sb, id);
      assert.equal(calls.first, 1); assert.equal(calls.second, 2);
      assert.equal((await a.findNotificationJob(id))?.status, "SENT"); assert.equal((await a.listFailedEvents()).length, 0);
      assert.equal((await sql.query("SELECT status FROM zook_frogsleep_buddy_notification_deliveries WHERE channel='apns'")).rows[0].status, "provider_accepted");
    });
    await suite.test("registering the same device to another account removes the old recipient's delivery target", async () => {
      const { _frogsleep_delivery, ...payload } = (await a.findNotificationJob(id))!.payload;
      const queued = await sa.queueNotification({ appId: "frogsleep", recipientUserId: "user_bob", channel: "push", payload, deduplicationKey: "transfer-device" });
      await notificationDevice(b, "first", "user_alice"); await notificationDevice(b, "second", "user_alice");
      assert.equal(await b.deleteFrogSleepDevice("frogsleep", "user_bob", "device_first"), undefined);
      assert.equal((await a.listFrogSleepDevices({ appId: "frogsleep", userId: "user_bob", pushEnabled: true })).length, 0);
      await run(sa, queued.notificationJobId!); assert.equal(calls.first, 1); assert.equal(calls.second, 2);
      assert.equal(((await b.findNotificationJob(queued.notificationJobId!))!.payload._frogsleep_delivery as any).outcome, "NO_ACTIVE_DEVICES");
    });
    await suite.test("original queued target cannot send after grant withdrawal", async () => {
      const original = (await a.findNotificationJob(id))!; const { _frogsleep_delivery, ...payload } = original.payload;
      const queued = await sa.queueNotification({ appId: "frogsleep", recipientUserId: "user_bob", channel: "push", payload, deduplicationKey: "withdraw-test" });
      await new BuddyConsentService(b).replaceOwn("user_alice", pair.relationshipId, "sleep", [], { presence: 0, daily_summary: 1, weekly_trend: 0, shared_activity: 1 });
      await run(sa, queued.notificationJobId!); assert.equal(calls.first, 1); assert.equal(calls.second, 2);
      assert.equal(((await b.findNotificationJob(queued.notificationJobId!))!.payload._frogsleep_delivery as any).outcome, "TARGET_UNAUTHORIZED");
    });
    await suite.test("email claims are exclusive and stale processing is not resent", async () => {
      const now = new Date().toISOString(); await a.upsertFrogSleepBuddyInvitationBundle({ id: "notification_email", appId: "frogsleep", inviterUserId: "user_alice", inviteeUserId: "user_bob",
        domains: ["focus"], status: "pending", version: 1, domainInvitationIds: {}, domainErrorCodes: {}, shareCode: "PG-EMAIL", handoffToken: "pg-email", shareLink: "https://example.com/invite",
        locale: "en", expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: now, updatedAt: now });
      await a.enqueueFrogSleepBuddyInvitationEmailDelivery({ id: "email_delivery_pg", appId: "frogsleep", invitationId: "notification_email", recipientEmail: "bob@example.com", recipientEmailHash: "test-hash",
        locale: "en", status: "queued", attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now });
      let sends = 0; const sender = { async send() { sends += 1; return { provider: "tencent_ses" as const, requestId: "pg_req", messageId: "pg_msg" }; } };
      await Promise.all([new BuddyInvitationEmailWorkerService(a, sender).processBatch(), new BuddyInvitationEmailWorkerService(b, sender).processBatch()]);
      assert.equal(sends, 1); assert.equal((await b.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", "notification_email"))?.status, "provider_accepted");
      await a.updateFrogSleepBuddyInvitationEmailDelivery("email_delivery_pg", { status: "processing", updatedAt: new Date(0).toISOString() });
      await new BuddyInvitationEmailWorkerService(b, sender).processBatch(); assert.equal(sends, 1);
      assert.equal((await a.findFrogSleepBuddyInvitationEmailDelivery("frogsleep", "notification_email"))?.lastErrorCode, "PROVIDER_OUTCOME_UNKNOWN");
    });
    await suite.test("legacy duplicate tokens preserve only the latest registration within the same app/platform", async () => {
      await sql.query("BEGIN");
      await sql.query("DROP INDEX uq_frogsleep_devices_live_token");
      await sql.query("ALTER TABLE zook_frogsleep_devices ADD CONSTRAINT zook_frogsleep_devices_app_id_user_id_push_token_key UNIQUE(app_id,user_id,push_token)");
      await sql.query(`INSERT INTO zook_frogsleep_devices(id,app_id,user_id,platform,push_token,push_enabled,created_at,updated_at)
        VALUES('legacy_recent','frogsleep','user_bob','ios','first',TRUE,NOW(),NOW()+INTERVAL '1 second'),
        ('other_app_token','app_a','user_alice','ios','first',TRUE,NOW(),NOW()),
        ('other_app_bob','app_a','user_bob','ios','first',TRUE,NOW(),NOW()),
        ('ambiguous_a','frogsleep','user_alice','ios','tied',TRUE,NOW(),NOW()),
        ('ambiguous_b','frogsleep','user_bob','ios','tied',TRUE,NOW(),NOW())`);
      const migration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/069_frogsleep_device_current_owner.sql", import.meta.url), "utf8");
      await sql.query(migration); await sql.query("COMMIT");
      const current = (await sql.query("SELECT app_id,user_id FROM zook_frogsleep_devices WHERE push_token='first' AND deleted_at IS NULL ORDER BY app_id,user_id")).rows;
      assert.deepEqual(current, [{ app_id: "app_a", user_id: "user_alice" }, { app_id: "app_a", user_id: "user_bob" }, { app_id: "frogsleep", user_id: "user_bob" }]);
      assert.equal((await sql.query("SELECT count(*)::int AS n FROM zook_frogsleep_devices WHERE push_token='tied' AND deleted_at IS NULL")).rows[0].n, 0);
      await notificationDevice(a, "tied", "user_alice");
      assert.equal((await a.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice", pushEnabled: true })).filter(value => value.pushToken === "tied").length, 1);
    });
    await suite.test("provider-accepted migration can rerun without rewriting historic delivery rows", async () => {
      const migration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/068_frogsleep_notification_provider_accepted.sql", import.meta.url), "utf8");
      const before = (await sql.query("SELECT id,status,created_at FROM zook_frogsleep_buddy_notification_deliveries ORDER BY id")).rows;
      await sql.query(migration); await sql.query(migration);
      const ownerMigration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/069_frogsleep_device_current_owner.sql", import.meta.url), "utf8");
      await sql.query(ownerMigration); await sql.query(ownerMigration);
      assert.deepEqual((await sql.query("SELECT id,status,created_at FROM zook_frogsleep_buddy_notification_deliveries ORDER BY id")).rows, before);
    });
  } finally { await sql.end(); await a.close(); await b.close(); }
});

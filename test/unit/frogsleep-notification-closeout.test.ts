import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { NotificationService, type PushDispatcher } from "../../src/services/notification.service.ts";
import { FailedEventRetryService } from "../../src/services/failed-event-retry.service.ts";
import { BuddyNotificationWorkerService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-worker.service.ts";
import { BuddyNotificationService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification.service.ts";
import { BuddyNotificationPreferenceService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { BuddyRelationshipLifecycleService } from "../../src/modules/frogsleep/buddy-growth/buddy-relationship-lifecycle.service.ts";
import { CompositePushDispatcher } from "../../src/services/composite-push-dispatcher.ts";
import { notificationFixture, notificationDevice } from "../helpers/frogsleep-notification-fixture.ts";

async function fixture(dispatcher: PushDispatcher = { async dispatch() {} }) {
  process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "true";
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const pair = await notificationFixture(database), queue = new InMemoryJobQueue();
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const service = new NotificationService(database, queue, logger, dispatcher);
  const worker = () => new BuddyNotificationWorkerService(database, service, undefined, true);
  const replay = () => new FailedEventRetryService(database, queue, logger);
  return { database, pair, queue, service, worker, replay };
}
const run = (service: NotificationService, id: string) => service.processQueueJob({ id: "redelivery", name: "notification.send", payload: { notificationJobId: id } });

test("concurrent outbox workers and crash replay retain one feed, logical job and in-app delivery", async () => {
  const f = await fixture(); await Promise.all([f.worker().processBatch(), f.worker().processBatch()]);
  assert.equal(f.database.frogSleepBuddyNotifications.length, 1); assert.equal(f.database.notificationJobs.length, 1);
  await f.database.updateFrogSleepBuddyNotificationOutbox(f.pair.outbox.id, { status: "processing" });
  await f.worker().processBatch();
  assert.equal(f.database.notificationJobs.length, 1); assert.equal(f.queue.jobs.length, 1);
  assert.equal(f.database.frogSleepBuddyNotificationDeliveries.filter(value => value.channel === "in_app").length, 1);
});

test("enqueue failure and concurrent outbox/recovery retries use the same original job", async () => {
  let sends = 0; const f = await fixture({ async dispatch() { sends += 1; } });
  await notificationDevice(f.database, "device-one"); f.queue.markNextAddAsFailure(); await f.worker().processBatch();
  assert.equal(f.database.notificationJobs.length, 1); assert.equal((await f.database.listFailedEvents()).length, 1);
  await Promise.all([f.worker().processBatch(), f.replay().retryDueEvents(new Date(Date.now() + 120_000)), f.replay().retryDueEvents(new Date(Date.now() + 120_000))]);
  assert.equal(f.database.notificationJobs.length, 1); assert.equal(f.queue.jobs.length, 1);
  await f.queue.processDueJobs(job => f.service.processQueueJob(job));
  assert.equal(sends, 1); assert.equal((await f.database.listFailedEvents()).length, 0);
});

test("partial provider success persists per-device receipts and retries only the failed device", async () => {
  const sends: string[] = []; let offline = true;
  const f = await fixture({ async dispatch(request) { sends.push(request.pushToken); if (request.pushToken === "second" && offline) throw new Error("provider down"); } });
  await notificationDevice(f.database, "first"); await notificationDevice(f.database, "second"); await f.worker().processBatch();
  await f.queue.processDueJobs(job => f.service.processQueueJob(job)); const id = f.database.notificationJobs[0]!.id;
  assert.equal(f.database.notificationJobs[0]!.status, "FAILED"); assert.equal((await f.database.listFailedEvents()).length, 1);
  offline = false; await Promise.all([run(f.service, id), run(f.service, id)]); await run(f.service, id);
  assert.equal(sends.filter(token => token === "first").length, 1);
  assert.equal(sends.filter(token => token === "second").length, 2);
  assert.equal(f.database.notificationJobs[0]!.status, "SENT"); assert.equal((await f.database.listFailedEvents()).length, 0);
  assert.equal(JSON.stringify(f.database.notificationJobs[0]!.payload._frogsleep_delivery).includes('"first"'), false);
});

test("queued and retried jobs revalidate silence, consent, quiet hours, category and capability", async () => {
  for (const change of ["mute", "revoke", "pause", "ended", "quiet", "disabled", "flag"]) {
    let sends = 0; const f = await fixture({ async dispatch() { sends += 1; throw new Error("provider down"); } });
    await notificationDevice(f.database, "one"); await f.worker().processBatch();
    await f.queue.processDueJobs(job => f.service.processQueueJob(job)); const id = f.database.notificationJobs[0]!.id;
    if (change === "mute") await new BuddyRelationshipLifecycleService(f.database).execute("user_bob", f.pair.relationshipId, "mute", 1);
    if (change === "pause" || change === "ended") await new BuddyRelationshipLifecycleService(f.database).execute("user_bob", f.pair.relationshipId, change === "pause" ? "pause" : "revoke", 1);
    if (change === "revoke") await new BuddyConsentService(f.database).replaceOwn("user_alice", f.pair.relationshipId, "sleep", [], { presence: 0, daily_summary: 1, weekly_trend: 0, shared_activity: 1 });
    if (change === "quiet") await new BuddyNotificationPreferenceService(f.database).update("user_bob", { quiet_start_minute: 0, quiet_end_minute: 1439 });
    if (change === "disabled") await new BuddyNotificationPreferenceService(f.database).update("user_bob", { enabled: false });
    if (change === "flag") process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "false";
    await run(f.service, id); assert.equal(sends, 1, change);
    assert.equal((await f.database.listFailedEvents()).length, 0, change);
  }
});

test("preference changes on an outbox retry cannot bypass disabled categories", async () => {
  const f = await fixture(); f.queue.markNextAddAsFailure(); await f.worker().processBatch();
  await new BuddyNotificationPreferenceService(f.database).update("user_bob", { disabled_categories: ["interactions"] });
  await f.worker().processBatch(); await f.replay().retryDueEvents(new Date(Date.now() + 120_000));
  await f.queue.processDueJobs(job => f.service.processQueueJob(job));
  assert.equal(f.queue.jobs.length, 0); assert.equal((await f.database.listFailedEvents()).length, 0);
  assert.equal(f.database.frogSleepBuddyNotificationOutbox[0]!.lastErrorCode, "PREFERENCE_DISABLED");
});

test("no devices converges once while the same in-app feed and authorized route remain usable", async () => {
  let sends = 0; const f = await fixture({ async dispatch() { sends += 1; } }); await f.worker().processBatch();
  await f.queue.processDueJobs(job => f.service.processQueueJob(job)); const job = f.database.notificationJobs[0]!;
  await run(f.service, job.id); assert.equal(sends, 0); assert.equal((await f.database.listFailedEvents()).length, 0);
  assert.equal((job.payload._frogsleep_delivery as any).outcome, "NO_ACTIVE_DEVICES");
  const inbox = new BuddyNotificationService(f.database); const feed = await inbox.list("user_bob", 20);
  assert.equal(feed.notifications.length, 1); assert.equal((await inbox.unreadCount("user_bob")).unread_count, 1);
  assert.equal((await inbox.resolve("user_bob", feed.notifications[0]!.id)).route.interaction_id, f.pair.targetId);
});

test("provider failures are bounded and one failed event does not multiply across replay", async () => {
  let calls = 0; const f = await fixture({ async dispatch() { calls += 1; throw new Error("outage"); } });
  await notificationDevice(f.database, "one"); await f.worker().processBatch(); const id = f.database.notificationJobs[0]!.id;
  for (let attempt = 0; attempt < 7; attempt += 1) await run(f.service, id);
  assert.equal(calls, 5); assert.equal(f.database.notificationJobs[0]!.retryCount, 5);
  assert.equal((await f.database.listFailedEvents()).length, 0);
  assert.equal((f.database.notificationJobs[0]!.payload._frogsleep_delivery as any).outcome, "retry_exhausted");
});

test("permanent invalid token is isolated to its device and is not retried", async () => {
  let calls = 0; const f = await fixture({ async dispatch(request) { calls += 1; await request.invalidateToken?.(); } });
  await notificationDevice(f.database, "bad"); await notificationDevice(f.database, "other-owner", "user_alice");
  await f.worker().processBatch(); await f.queue.processDueJobs(job => f.service.processQueueJob(job));
  await run(f.service, f.database.notificationJobs[0]!.id);
  assert.equal(calls, 1); assert.equal((await f.database.listFrogSleepDevices({ appId: "frogsleep", userId: "user_alice" })).length, 1);
  assert.equal((await f.database.listFailedEvents()).length, 0);
});

test("missing provider is a failure rather than a successful logging-only delivery", async () => {
  const f = await fixture(new CompositePushDispatcher({})); await notificationDevice(f.database, "one"); await f.worker().processBatch();
  await f.queue.processDueJobs(job => f.service.processQueueJob(job));
  assert.equal(f.database.notificationJobs[0]!.status, "FAILED"); assert.equal((await f.database.listFailedEvents()).length, 1);
  assert.equal(f.database.frogSleepBuddyNotifications.length, 1);
});

test("device disabled or transferred while queued cannot receive another owner's Push", async () => {
  let calls = 0; const f = await fixture({ async dispatch() { calls += 1; } });
  await notificationDevice(f.database, "transferred"); await f.worker().processBatch();
  await notificationDevice(f.database, "transferred", "user_alice");
  await f.queue.processDueJobs(job => f.service.processQueueJob(job));
  assert.equal(calls, 0); assert.equal(f.database.frogSleepBuddyNotifications.length, 1);
});

test("lost provider response is marked uncertain without resending or claiming device delivery", async () => {
  let calls = 0; const f = await fixture({ async dispatch() { calls += 1; throw new TypeError("response lost"); } });
  await notificationDevice(f.database, "unknown"); await f.worker().processBatch();
  await f.queue.processDueJobs(job => f.service.processQueueJob(job)); await run(f.service, f.database.notificationJobs[0]!.id);
  assert.equal(calls, 1); assert.equal((await f.database.listFailedEvents()).length, 0);
  assert.equal((f.database.notificationJobs[0]!.payload._frogsleep_delivery as any).outcome, "PROVIDER_OUTCOME_UNKNOWN");
  assert.equal(f.database.frogSleepBuddyNotificationDeliveries.find(value => value.channel === "apns")?.status, "failed");
});

test("interrupted durable processing becomes unknown rather than resending after a crash", async () => {
  for (const retryCount of [1, 5]) {
    let calls = 0; const f = await fixture({ async dispatch() { calls += 1; } });
    await notificationDevice(f.database, "crash-token"); await f.worker().processBatch();
    const job = f.database.notificationJobs[0]!;
    const key = createHash("sha256").update(JSON.stringify(["frogsleep", "user_bob", "ios", "crash-token"])).digest("hex");
    await f.database.updateNotificationJob(job.id, { retryCount, payload: { ...job.payload, _frogsleep_delivery: { devices: { [key]: "processing" } } } });
    await run(f.service, job.id); await run(f.service, job.id);
    assert.equal(calls, 0); assert.equal((job.payload._frogsleep_delivery as any).outcome, "PROVIDER_OUTCOME_UNKNOWN");
    assert.equal((await f.database.listFailedEvents()).length, 0);
  }
});

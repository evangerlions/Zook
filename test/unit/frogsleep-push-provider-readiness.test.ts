import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { buildFrogSleepNotificationPayload } from "../../src/modules/frogsleep/frogsleep-notifications.ts";
import { CompositePushDispatcher } from "../../src/services/composite-push-dispatcher.ts";
import { NotificationService, type PushDispatcher } from "../../src/services/notification.service.ts";
import { createPushDispatcher } from "../../src/services/push-dispatcher-factory.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function processPush(platform: string, factory: (database: InMemoryDatabase, logger: StructuredLogger) => PushDispatcher | undefined) {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const queue = new InMemoryJobQueue();
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const now = new Date().toISOString();
  database.upsertFrogSleepDevice({ id: "active-device", appId: "frogsleep", userId: "user_alice",
    platform, pushToken: "test-token", pushEnabled: true, createdAt: now, updatedAt: now });
  const notifications = new NotificationService(database, queue, logger, factory(database, logger));
  const queued = await notifications.queueNotification({ appId: "frogsleep", recipientUserId: "user_alice",
    channel: "push", payload: buildFrogSleepNotificationPayload({ type: "sleep_buddy_invite", entityId: "invite_1" }) });
  await queue.processDueJobs((job) => notifications.processQueueJob(job));
  return { database, queue, record: await database.findNotificationJob(queued.notificationJobId) };
}

test("FrogSleep without configured providers records FAILED and leaves a retry path", async () => {
  const keys = ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID", "APNS_TOPIC", "APNS_PRIVATE_KEY_PATH",
    "FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT_PATH", "LIGHTTICK_FCM_PROJECT_ID", "LIGHTTICK_FCM_SERVICE_ACCOUNT_PATH",
    "BODYLOG_FCM_PROJECT_ID", "BODYLOG_FCM_SERVICE_ACCOUNT_PATH"];
  const saved = keys.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of keys) delete process.env[key];
    const result = await processPush("ios", (database, logger) => createPushDispatcher({ database, logger }));
    assert.equal(result.record?.status, "FAILED", "logging fallback is not successful provider delivery");
    const failed = await result.database.listFailedEvents("frogsleep");
    assert.ok(result.queue.jobs.length > 0 || failed.some((event) => event.nextRetryAt), "delivery must remain retryable");
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("FrogSleep missing current platform dispatcher cannot become SENT", async () => {
  const result = await processPush("android", () => new CompositePushDispatcher({
    ios: { async dispatch() { throw new Error("iOS provider must not receive Android devices"); } },
  }));
  assert.equal(result.record?.status, "FAILED");
  assert.ok((await result.database.listFailedEvents("frogsleep")).length > 0 || result.queue.jobs.length > 0);
});

test("FrogSleep default notification dispatcher cannot mistake logging for delivery", async () => {
  const result = await processPush("ios", () => undefined);
  assert.equal(result.record?.status, "FAILED");
  assert.ok((await result.database.listFailedEvents("frogsleep")).length > 0 || result.queue.jobs.length > 0);
});

test("FrogSleep configured platform reports SENT after actual provider success", async () => {
  const accepted: string[] = [];
  const result = await processPush("android", () => new CompositePushDispatcher({
    android: { async dispatch(request) { accepted.push(request.pushToken); } },
  }));
  assert.equal(result.record?.status, "SENT");
  assert.deepEqual(accepted, ["test-token"]);
  assert.equal((await result.database.listFailedEvents("frogsleep")).length, 0);
});

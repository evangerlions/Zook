import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { buildFrogSleepNotificationPayload } from "../../src/modules/frogsleep/frogsleep-notifications.ts";
import { NotificationService, type PushDispatchRequest } from "../../src/services/notification.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { BuddyNotificationPreferenceService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";

test("FrogSleep push notifications dispatch to active app-scoped devices", async () => {
  const database = await notificationDatabase();
  const queue = new InMemoryJobQueue();
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const dispatched: PushDispatchRequest[] = [];
  const service = new NotificationService(database, queue, logger, {
    async dispatch(request) {
      dispatched.push(request);
    },
  });
  const now = new Date().toISOString();

  database.upsertFrogSleepDevice({
    id: "device_alice",
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "push_token_alice",
    pushEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const result = await service.queueNotification({
    appId: "frogsleep",
    recipientUserId: "user_alice",
    channel: "push",
    payload: buildFrogSleepNotificationPayload({
      type: "sleep_buddy_invite",
      entityId: "invite_1",
    }),
  });
  assert.equal(result.queued, true);

  await queue.processDueJobs((job) => service.processQueueJob(job));

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].pushToken, "push_token_alice");
  assert.equal(dispatched[0].payload.type, "sleep_buddy_invite");
  assert.equal((await database.findNotificationJob(result.notificationJobId))?.status, "SENT");
});

test("FrogSleep push notifications with no devices do not block worker processing", async () => {
  const database = await notificationDatabase();
  const queue = new InMemoryJobQueue();
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const service = new NotificationService(database, queue, logger, {
    async dispatch() {
      throw new Error("dispatch should not be called");
    },
  });

  const result = await service.queueNotification({
    appId: "frogsleep",
    recipientUserId: "user_alice",
    channel: "push",
    payload: buildFrogSleepNotificationPayload({
      type: "sleep_buddy_invite",
      entityId: "invite_1",
    }),
  });

  await queue.processDueJobs((job) => service.processQueueJob(job));

  const job = await database.findNotificationJob(result.notificationJobId);
  assert.equal(job?.status, "SENT");
  assert.equal((job?.payload._frogsleep_delivery as { outcome: string }).outcome, "NO_ACTIVE_DEVICES");
  assert.equal((await database.listFailedEvents("frogsleep")).length, 0);
});

test("FrogSleep push provider failures preserve failed event behavior", async () => {
  const database = await notificationDatabase();
  const queue = new InMemoryJobQueue();
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const service = new NotificationService(database, queue, logger, {
    async dispatch() {
      throw new Error("provider down");
    },
  });
  const now = new Date().toISOString();
  database.upsertFrogSleepDevice({
    id: "device_alice",
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "push_token_alice",
    pushEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const result = await service.queueNotification({
    appId: "frogsleep",
    recipientUserId: "user_alice",
    channel: "push",
    payload: buildFrogSleepNotificationPayload({
      type: "focus_achievement",
      entityId: "milestone_1",
    }),
  });

  await queue.processDueJobs((job) => service.processQueueJob(job));

  assert.equal((await database.findNotificationJob(result.notificationJobId))?.status, "FAILED");
  assert.equal((await database.listFailedEvents("frogsleep")).length, 1);
});

async function notificationDatabase() {
  process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "true";
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const now = new Date().toISOString();
  await database.insertAppUser({ id: "notification_alice", appId: "frogsleep", userId: "user_alice", status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now });
  await database.insertFrogSleepEntity({ id: "invite_1", appId: "frogsleep", kind: "sleep_invite", ownerUserId: "user_bob",
    partnerUserId: "user_alice", status: "pending", payload: {}, createdAt: now, updatedAt: now });
  await new BuddyNotificationPreferenceService(database).update("user_alice",
    { quiet_start_minute: 0, quiet_end_minute: 0, cooldown_minutes: 0, daily_budget: 100 });
  return database;
}

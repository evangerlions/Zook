import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { NotificationService, type PushDispatchRequest } from "../../src/services/notification.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function sharedSleep() {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const queue = new InMemoryJobQueue();
  const delivered: PushDispatchRequest[] = [];
  const notifications = new NotificationService(database, queue,
    new StructuredLogger("test", { emitToConsole: false }), {
      async dispatch(request) { delivered.push(request); },
    });
  const sleep = new FrogSleepSleepBuddyService(database, notifications);
  const invite = await sleep.createInvite({ userId: "user_alice", invitee: "user_bob" });
  const relationship = await sleep.acceptInviteByCode("user_bob", String(invite.code));
  const relationshipId = String(relationship.relationship_id);
  const session = await sleep.beginSession("user_alice", relationshipId);
  const sessionId = String(session.session_id);
  await sleep.acceptSession("user_bob", sessionId);
  await queue.processDueJobs((job) => notifications.processQueueJob(job));
  const now = new Date().toISOString();
  database.upsertFrogSleepDevice({ id: "bob-device", appId: "frogsleep", userId: "user_bob",
    platform: "ios", pushToken: "test-token", pushEnabled: true, createdAt: now, updatedAt: now });
  delivered.length = 0;
  return { database, queue, delivered, notifications, sleep, relationshipId, sessionId };
}

const disabledCases = [
  { preference: { mute_for_tonight: true }, event: "interrupted", type: "shared_session_interrupted" },
  { preference: { mute_for_tonight: true }, event: "returned", type: "shared_session_returned" },
  { preference: { mute_for_tonight: true }, event: "morning_completed", type: "morning_summary" },
  { preference: { allow_recovery_nudges: false }, event: "interrupted", type: "shared_session_interrupted" },
  { preference: { allow_recovery_nudges: false }, event: "returned", type: "shared_session_returned" },
  { preference: { allow_morning_summary_push: false }, event: "morning_completed", type: "morning_summary" },
];

for (const scenario of disabledCases) {
  const preferenceName = Object.keys(scenario.preference)[0];
  test(`recipient ${preferenceName} suppresses ${scenario.type} before enqueue`, async () => {
    const fixture = await sharedSleep();
    await fixture.sleep.updatePreferences("user_bob", fixture.relationshipId, scenario.preference);
    await fixture.sleep.recordEvent("user_alice", fixture.sessionId, scenario.event);
    assert.equal(fixture.queue.jobs.length, 0, "disabled recipient notification must not enter the queue");
    await fixture.queue.processDueJobs((job) => fixture.notifications.processQueueJob(job));
    assert.equal(fixture.delivered.length, 0);
  });

  test(`recipient ${preferenceName} suppresses already queued ${scenario.type}`, async () => {
    const fixture = await sharedSleep();
    await fixture.sleep.recordEvent("user_alice", fixture.sessionId, scenario.event);
    assert.equal(fixture.queue.jobs.length, 1, "allowed notification should initially be queued");
    const notificationJobId = String(fixture.queue.jobs[0].payload.notificationJobId);
    await fixture.sleep.updatePreferences("user_bob", fixture.relationshipId, scenario.preference);
    await fixture.queue.processDueJobs((job) => fixture.notifications.processQueueJob(job));
    assert.equal(fixture.delivered.length, 0, "worker must respect recipient's latest preference");
    assert.equal((await fixture.database.findNotificationJob(notificationJobId))?.status, "SUPPRESSED");
  });
}

test("enabled recipient receives recovery and morning notifications despite sender muting", async () => {
  const fixture = await sharedSleep();
  await fixture.sleep.updatePreferences("user_alice", fixture.relationshipId, { mute_for_tonight: true });
  await fixture.sleep.updatePreferences("user_bob", fixture.relationshipId, {
    mute_for_tonight: false, allow_recovery_nudges: true, allow_morning_summary_push: true,
  });
  for (const event of ["interrupted", "returned", "morning_completed"]) {
    await fixture.sleep.recordEvent("user_alice", fixture.sessionId, event);
  }
  await fixture.queue.processDueJobs((job) => fixture.notifications.processQueueJob(job));
  assert.deepEqual(fixture.delivered.map((request) => request.payload.type), [
    "shared_session_interrupted", "shared_session_returned", "morning_summary",
  ]);
  assert.ok(fixture.delivered.every((request) => request.userId === "user_bob"));
});

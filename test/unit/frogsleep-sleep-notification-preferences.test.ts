import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { FrogSleepSleepBuddyService } from "../../src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { NotificationService, type PushDispatchRequest } from "../../src/services/notification.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { BuddyNotificationPreferenceService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";

// Delivery is disabled by default outside the dev rollout.
process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "true";

async function sharedSleep() {
  const database = new InMemoryDatabase(buildDefaultSeed(undefined, { includeFrogSleep: true }));
  const now = new Date().toISOString();
  for (const userId of ["user_alice", "user_bob"]) {
    await database.insertAppUser({ id: `sleep_notification_${userId}`, appId: "frogsleep", userId,
      status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now });
    await new BuddyNotificationPreferenceService(database).update(userId,
      { quiet_start_minute: 0, quiet_end_minute: 0, cooldown_minutes: 0, daily_budget: 100 });
  }
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
    const job = await fixture.database.findNotificationJob(notificationJobId);
    assert.equal(job?.status, "SENT");
    assert.equal((job?.payload._frogsleep_delivery as { outcome: string }).outcome,
      preferenceName === "mute_for_tonight" ? "SLEEP_MUTED"
        : preferenceName === "allow_recovery_nudges" ? "RECOVERY_PUSH_DISABLED" : "MORNING_PUSH_DISABLED");
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

test("relationship notification records cannot mask recipient sleep preferences", async () => {
  const fixture = await sharedSleep();
  await fixture.sleep.updatePreferences("user_bob", fixture.relationshipId, { allow_recovery_nudges: false });
  const now = new Date(Date.now() + 1000).toISOString();
  await fixture.database.insertFrogSleepEntity({ id: "bob-relationship-preference", appId: "frogsleep",
    kind: "guardianship_preference", ownerUserId: "user_bob", relationshipId: fixture.relationshipId,
    status: "buddy_relationship_notifications", payload: { muted: false }, createdAt: now, updatedAt: now });
  await fixture.sleep.recordEvent("user_alice", fixture.sessionId, "interrupted");
  assert.equal(fixture.queue.jobs.length, 0);
});

test("accept cannot reset a participant's terminal morning completion", async () => {
  const fixture = await sharedSleep();
  await fixture.sleep.recordEvent("user_alice", fixture.sessionId, "morning_completed");
  await assert.rejects(fixture.sleep.acceptSession("user_alice", fixture.sessionId), { statusCode: 409 });
  const completed = await fixture.sleep.recordEvent("user_bob", fixture.sessionId, "morning_completed");
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.participant_states, { user_alice: "morning_completed", user_bob: "morning_completed" });
});

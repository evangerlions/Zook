import type { ApplicationDatabase } from "../../src/infrastructure/database/application-database.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { BuddyNotificationPreferenceService } from "../../src/modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";

/** Seeds a canonical pair and valid protected target without calling external providers. */
export async function notificationFixture(database: ApplicationDatabase, suffix = "delivery") {
  const now = new Date().toISOString(), relationshipId = `pair_${suffix}`, targetId = `share_${suffix}`;
  for (const userId of ["user_alice", "user_bob"]) {
    if (!await database.findAppUser("frogsleep", userId)) await database.insertAppUser({ id: `notification_member_${userId}`,
      appId: "frogsleep", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now });
  }
  await database.insertFrogSleepBuddyDomainRelationship({ id: relationshipId, appId: "frogsleep", domain: "sleep",
    userIdLow: "user_alice", userIdHigh: "user_bob", status: "active", pausedByUserIds: [], version: 1, createdAt: now, updatedAt: now });
  for (const userId of ["user_alice", "user_bob"]) {
    const slot = await database.ensureFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId, domain: "sleep", now });
    await database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: "frogsleep", userId, domain: "sleep", state: "occupied",
      relationshipId, expectedVersion: slot.version, updatedAt: now });
  }
  await new BuddyConsentService(database).replaceOwn("user_alice", relationshipId, "sleep", ["daily_summary", "shared_activity"],
    { presence: 0, daily_summary: 0, weekly_trend: 0, shared_activity: 0 });
  await new BuddyNotificationPreferenceService(database).update("user_bob", {
    quiet_start_minute: 0, quiet_end_minute: 0, cooldown_minutes: 0, daily_budget: 100 });
  await database.insertFrogSleepEntity({ id: targetId, appId: "frogsleep", kind: "buddy_share", ownerUserId: "user_alice",
    partnerUserId: "user_bob", relationshipId, status: "shared", payload: { type: "sleep_summary" }, createdAt: now, updatedAt: now });
  const outbox = await database.enqueueFrogSleepBuddyNotificationOutbox({ id: `outbox_${suffix}`, appId: "frogsleep", recipientUserId: "user_bob",
    eventType: "interaction_received", targetType: "buddy_share", targetId, deduplicationKey: `notification_${suffix}`,
    safeRoute: { type: "buddy_share", relationship_id: relationshipId, interaction_id: targetId },
    status: "pending", attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now });
  return { relationshipId, targetId, outbox };
}

export async function notificationDevice(database: ApplicationDatabase, token: string, userId = "user_bob") {
  const now = new Date().toISOString();
  await database.upsertFrogSleepDevice({ id: `device_${token}`, appId: "frogsleep", userId, platform: "ios",
    pushToken: token, pushEnabled: true, createdAt: now, updatedAt: now });
}

import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { NotificationJobRecord } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { authorizeBuddyNotificationTarget } from "../modules/frogsleep/buddy-growth/buddy-notification-target.ts";
import { BuddyNotificationPreferenceService } from "../modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";
import { resolveBuddyGrowthCapabilities } from "../modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import { assertBuddyDataAuthorized } from "../modules/frogsleep/buddy-growth/buddy-protected-access.ts";
import { buddyRelationshipMute } from "../modules/frogsleep/buddy-growth/buddy-relationship-lifecycle.service.ts";
import { assertBuddyPairNotBlocked } from "../modules/frogsleep/buddy-growth/buddy-safety.ts";

/** Revalidates queued and replayed FrogSleep Push against current recipient, target, preferences and grants. */
export async function frogSleepPushSuppression(database: ApplicationDatabase, record: NotificationJobRecord): Promise<string | undefined> {
  if ((await database.findAppUser(record.appId, record.recipientUserId))?.status !== "ACTIVE") return "RECIPIENT_UNAVAILABLE";
  const payload = record.payload, data = (payload.data ?? {}) as Record<string, string>;
  if (payload.type === "focus_achievement") return undefined;
  if (!resolveBuddyGrowthCapabilities().pushDelivery) return "CAPABILITY_DISABLED";
  try {
    if (payload.type === "buddy_notification") {
      const id = String(payload.entityId ?? data.notification_id ?? "");
      const notification = await database.findFrogSleepBuddyNotification(record.appId, record.recipientUserId, id);
      if (!notification || data.notification_id !== id) return "TARGET_UNAVAILABLE";
      await authorizeBuddyNotificationTarget(database, record.recipientUserId, notification, true);
      if (notification.notificationType === "invitation_created" && !await pendingInvitation(database, notification.targetId)) return "TARGET_TERMINAL";
      const decision = await new BuddyNotificationPreferenceService(database).deliveryDecision(
        record.recipientUserId, notification.notificationType, notification.targetId, new Date(), notification.id);
      return decision.suppressAll ?? decision.suppressPush;
    }
    return await legacySuppression(database, record);
  } catch (error) {
    if (error instanceof ApplicationError && [403, 404].includes(error.statusCode)) return "TARGET_UNAUTHORIZED";
    throw error;
  }
}

async function pendingInvitation(database: ApplicationDatabase, id: string) {
  const bundle = await database.findFrogSleepBuddyInvitationBundle("frogsleep", id);
  const invite = bundle ?? await database.findFrogSleepEntity("sleep_invite", "frogsleep", id)
    ?? await database.findFrogSleepEntity("focus_invite", "frogsleep", id);
  return invite?.status === "pending";
}

async function legacySuppression(database: ApplicationDatabase, record: NotificationJobRecord) {
  const payload = record.payload;
  if (["sleep_buddy_invite", "focus_buddy_invite"].includes(String(payload.type))) {
    const kind = payload.type === "sleep_buddy_invite" ? "sleep_invite" : "focus_invite";
    const invite = await database.findFrogSleepEntity(kind, record.appId, String(payload.entityId ?? ""));
    if (!invite || invite.partnerUserId !== record.recipientUserId || invite.status !== "pending") return "TARGET_UNAVAILABLE";
    if (invite.payload.expires_at && Date.parse(String(invite.payload.expires_at)) <= Date.now()) return "TARGET_EXPIRED";
    await assertBuddyPairNotBlocked(database, invite.ownerUserId!, record.recipientUserId);
    const decision = await new BuddyNotificationPreferenceService(database).deliveryDecision(record.recipientUserId, "invitation_created", invite.id);
    return decision.suppressAll ?? decision.suppressPush;
  }
  const session = await database.findFrogSleepEntity("sleep_session", record.appId, String(payload.sessionId ?? ""));
  if (!session?.relationshipId || ![session.ownerUserId, session.partnerUserId].includes(record.recipientUserId)
    || ["cancelled", "revoked", "expired"].includes(session.status ?? "")) return "TARGET_UNAVAILABLE";
  if (payload.relationshipId && payload.relationshipId !== session.relationshipId) return "TARGET_UNAVAILABLE";
  await assertBuddyDataAuthorized(database, record.recipientUserId, session.relationshipId, payload.type === "morning_summary" ? "daily_summary" : "shared_activity");
  if ((await buddyRelationshipMute(database, record.recipientUserId, session.relationshipId))?.payload.muted === true) return "RELATIONSHIP_MUTED";
  const decision = await new BuddyNotificationPreferenceService(database).deliveryDecision(record.recipientUserId, "activity_updated", session.id);
  return decision.suppressAll ?? decision.suppressPush;
}

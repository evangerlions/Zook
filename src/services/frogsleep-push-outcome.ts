import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { NotificationJobRecord } from "../shared/types.ts";

/** Updates the logical Push handoff separately from the already delivered in-app fallback. */
export async function recordFrogSleepPushOutcome(database: ApplicationDatabase, record: NotificationJobRecord, outcome: string) {
  if (record.payload.type !== "buddy_notification") return;
  const data = record.payload.data as Record<string, string> | undefined;
  const notification = await database.findFrogSleepBuddyNotification(record.appId, record.recipientUserId, String(data?.notification_id ?? ""));
  if (!notification) return;
  await database.insertFrogSleepBuddyNotificationDelivery({ id: `buddy_push_${notification.id}`, appId: record.appId,
    notificationId: notification.id, channel: "apns", attempt: 1,
    status: outcome === "PROVIDER_ACCEPTED" ? "provider_accepted"
      : ["retryable_failed", "retry_exhausted", "PERMANENT_DEVICE_FAILURE", "PROVIDER_OUTCOME_UNKNOWN"].includes(outcome) ? "failed" : "suppressed",
    errorCode: outcome === "PROVIDER_ACCEPTED" ? undefined : outcome, createdAt: new Date().toISOString() });
}

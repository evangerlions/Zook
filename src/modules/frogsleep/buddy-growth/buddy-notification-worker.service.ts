import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { NotificationService } from "../../../services/notification.service.ts";
import type { FrogSleepBuddyNotificationOutboxRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { sanitizeBuddySafeRoute } from "./buddy-privacy.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";
import { BuddyNotificationPreferenceService } from "./buddy-notification-preference.service.ts";
import { resolveBuddyGrowthCapabilities } from "./buddy-growth-capabilities.ts";

/** Materializes buddy outbox events into in-app feed entries and safe APNs queue jobs. */
export class BuddyNotificationWorkerService {
  private readonly preferenceService: BuddyNotificationPreferenceService;

  constructor(
    private readonly database: ApplicationDatabase,
    private readonly notificationService: NotificationService,
    preferenceService?: BuddyNotificationPreferenceService,
    private readonly pushDeliveryEnabled = resolveBuddyGrowthCapabilities().pushDelivery,
  ) {
    this.preferenceService = preferenceService ?? new BuddyNotificationPreferenceService(database);
  }

  async processBatch(limit = 50): Promise<{ processed: number; failed: number }> {
    const entries = await this.database.listReadyFrogSleepBuddyNotificationOutbox(new Date().toISOString(), limit);
    let processed = 0; let failed = 0;
    for (const entry of entries) {
      try { await this.process(entry); processed += 1; }
      catch { await this.fail(entry); failed += 1; }
    }
    return { processed, failed };
  }

  private async process(entry: FrogSleepBuddyNotificationOutboxRecord) {
    const now = new Date().toISOString();
    const attempt = entry.attemptCount + 1;
    const safeRoute = sanitizeBuddySafeRoute(entry.safeRoute);
    await this.database.updateFrogSleepBuddyNotificationOutbox(entry.id,
      { status: "processing", attemptCount: attempt, updatedAt: now });
    const suppressionCode = await this.targetSuppressionCode(entry);
    if (suppressionCode) {
      await this.database.updateFrogSleepBuddyNotificationOutbox(entry.id, {
        status: "dead_letter", attemptCount: attempt, processedAt: now,
        lastErrorCode: suppressionCode, updatedAt: now,
      });
      return;
    }
    const decision = entry.attemptCount === 0
      ? await this.preferenceService.deliveryDecision(
        entry.recipientUserId, entry.eventType, entry.targetId, new Date(now),
      )
      : {};
    if (decision.suppressAll) {
      await this.database.updateFrogSleepBuddyNotificationOutbox(entry.id, {
        status: "delivered", attemptCount: attempt, processedAt: now,
        lastErrorCode: decision.suppressAll, updatedAt: now,
      });
      return;
    }
    const notification = await this.database.upsertFrogSleepBuddyNotification({
      id: `buddy_notification_${entry.id}`, appId: FROGSLEEP_APP_ID,
      recipientUserId: entry.recipientUserId, outboxId: entry.id, notificationType: entry.eventType,
      targetType: entry.targetType, targetId: entry.targetId, safeRoute,
      createdAt: entry.createdAt, updatedAt: now,
    });
    if (attempt === 1) {
      await this.database.insertFrogSleepBuddyNotificationDelivery({ id: randomId("buddy_delivery"),
        appId: FROGSLEEP_APP_ID, notificationId: notification.id, channel: "in_app", status: "delivered",
        attempt: 1, deliveredAt: now, createdAt: now });
    }
    const pushSuppression = this.pushDeliveryEnabled
      ? decision.suppressPush
      : "CAPABILITY_DISABLED";
    if (pushSuppression) {
      await this.database.insertFrogSleepBuddyNotificationDelivery({ id: randomId("buddy_delivery"),
        appId: FROGSLEEP_APP_ID, notificationId: notification.id, channel: "apns", status: "suppressed",
        attempt, errorCode: pushSuppression, createdAt: now });
      await this.database.updateFrogSleepBuddyNotificationOutbox(entry.id, {
        status: "delivered", processedAt: now, lastErrorCode: pushSuppression, updatedAt: now,
      });
      return;
    }
    const queued = await this.notificationService.queueNotification({ appId: FROGSLEEP_APP_ID,
      recipientUserId: entry.recipientUserId, channel: "push",
      payload: buildFrogSleepNotificationPayload({ type: "buddy_notification", entityId: notification.id,
        data: sanitizeBuddySafeRoute({ notification_id: notification.id, ...safeRoute }) }) });
    await this.database.insertFrogSleepBuddyNotificationDelivery({ id: randomId("buddy_delivery"),
      appId: FROGSLEEP_APP_ID, notificationId: notification.id, channel: "apns",
      status: queued.queued ? "pending" : "failed", attempt, errorCode: queued.queued ? undefined : "ENQUEUE_FAILED",
      createdAt: now });
    if (!queued.queued) throw new Error("APNs enqueue failed");
    await this.database.updateFrogSleepBuddyNotificationOutbox(entry.id,
      { status: "delivered", processedAt: now, lastErrorCode: undefined, updatedAt: now });
  }

  private async fail(entry: FrogSleepBuddyNotificationOutboxRecord) {
    const attempts = entry.attemptCount + 1;
    await this.database.updateFrogSleepBuddyNotificationOutbox(entry.id, {
      status: attempts >= 5 ? "dead_letter" : "failed", attemptCount: attempts,
      lastErrorCode: "DELIVERY_FAILED", updatedAt: new Date().toISOString(),
    });
  }

  private async targetSuppressionCode(entry: FrogSleepBuddyNotificationOutboxRecord): Promise<string | undefined> {
    if (entry.targetType !== "buddy_invitation") return undefined;
    const invite = await this.database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, entry.targetId)
      ?? await this.database.findFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, entry.targetId);
    const bundle = invite ? undefined
      : await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, entry.targetId);
    const inviterUserId = invite?.ownerUserId ?? bundle?.inviterUserId;
    const inviteeUserId = invite?.partnerUserId ?? bundle?.inviteeUserId;
    if (!invite && !bundle) return "TARGET_REVOKED";
    if (inviterUserId && inviteeUserId) {
      try { await assertBuddyPairNotBlocked(this.database, inviterUserId, inviteeUserId); }
      catch { return "TARGET_BLOCKED"; }
    }
    if (entry.eventType !== "invitation_created") return undefined;
    const status = invite?.status ?? bundle?.status;
    const expiresAt = String(invite?.payload.expires_at ?? bundle?.expiresAt ?? "");
    if (status !== "pending" || (expiresAt && expiresAt <= new Date().toISOString())) return "TARGET_EXPIRED";
    return undefined;
  }
}

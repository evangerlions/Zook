import { resolveBuddyGrowthCapabilities } from "./buddy-growth-capabilities.ts";
import { BuddyNotificationPreferenceService } from "./buddy-notification-preference.service.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type {
  FrogSleepBuddyInvitationEmailDeliveryRecord,
} from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import type { BuddyInvitationEmailSender } from "./buddy-invitation-email-sender.ts";

const MAX_ATTEMPTS = 5;

/** Sends canonical invitation email outbox entries without keeping request state on the worker singleton. */
export class BuddyInvitationEmailWorkerService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly sender: BuddyInvitationEmailSender,
  ) {}

  async processBatch(limit = 25): Promise<{ processed: number; failed: number }> {
    const deliveries = await this.database.claimReadyFrogSleepBuddyInvitationEmailDeliveries(
      new Date().toISOString(),
      limit,
    );
    let processed = 0;
    let failed = 0;
    for (const delivery of deliveries) {
      const outcome = await this.process(delivery);
      if (outcome === "processed") processed += 1;
      else failed += 1;
    }
    return { processed, failed };
  }

  private async process(delivery: FrogSleepBuddyInvitationEmailDeliveryRecord) {
    const invitation = await this.database.findFrogSleepBuddyInvitationBundle(
      FROGSLEEP_APP_ID,
      delivery.invitationId,
    );
    const attempt = delivery.attemptCount;
    const startedAt = new Date().toISOString();
    const suppressed = invitation ? await this.suppression(invitation) : "TARGET_REVOKED";
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= startedAt || suppressed) {
      await this.database.updateFrogSleepBuddyInvitationEmailDelivery(delivery.id, {
        status: "suppressed",
        attemptCount: delivery.attemptCount,
        lastErrorCode: suppressed ?? "TARGET_TERMINAL",
        suppressedAt: startedAt,
        updatedAt: startedAt,
      });
      return "processed";
    }
    const attemptId = randomId("buddy_email_attempt");
    await this.database.insertFrogSleepBuddyInvitationEmailAttempt({
      id: attemptId,
      appId: delivery.appId,
      deliveryId: delivery.id,
      invitationId: delivery.invitationId,
      attempt,
      status: "processing",
      createdAt: startedAt,
    });
    try {
      const result = await this.sender.send({
        invitation,
        recipientEmail: delivery.recipientEmail,
      });
      const completedAt = new Date().toISOString();
      await this.database.insertFrogSleepBuddyInvitationEmailAttempt({
        id: attemptId,
        appId: delivery.appId,
        deliveryId: delivery.id,
        invitationId: delivery.invitationId,
        attempt,
        status: "provider_accepted",
        providerRequestId: result.requestId,
        providerMessageId: result.messageId,
        createdAt: startedAt,
        completedAt,
      });
      await this.database.updateFrogSleepBuddyInvitationEmailDelivery(delivery.id, {
        status: "provider_accepted",
        attemptCount: attempt,
        providerRequestId: result.requestId,
        providerMessageId: result.messageId,
        providerAcceptedAt: completedAt,
        lastErrorCode: undefined,
        updatedAt: completedAt,
      });
      return "processed";
    } catch (error) {
      const completedAt = new Date().toISOString();
      const retryable = this.isRetryable(error) && attempt < MAX_ATTEMPTS;
      const errorCode = this.errorCode(error);
      await this.database.insertFrogSleepBuddyInvitationEmailAttempt({
        id: attemptId,
        appId: delivery.appId,
        deliveryId: delivery.id,
        invitationId: delivery.invitationId,
        attempt,
        status: retryable ? "retryable_failed" : "permanent_failed",
        errorCode,
        createdAt: startedAt,
        completedAt,
      });
      await this.database.updateFrogSleepBuddyInvitationEmailDelivery(delivery.id, {
        status: retryable ? "retryable_failed" : "dead_letter",
        attemptCount: attempt,
        availableAt: new Date(Date.now() + this.backoffMs(attempt)).toISOString(),
        lastErrorCode: errorCode,
        deadLetteredAt: retryable ? undefined : completedAt,
        updatedAt: completedAt,
      });
      return "failed";
    }
  }

  private async suppression(invitation: import("../../../shared/types.ts").FrogSleepBuddyInvitationBundleRecord) {
    if (!resolveBuddyGrowthCapabilities().emailDelivery) return "CAPABILITY_DISABLED";
    if ((await this.database.findAppUser(FROGSLEEP_APP_ID, invitation.inviterUserId))?.status !== "ACTIVE") return "TARGET_REVOKED";
    if (!invitation.inviteeUserId) return undefined;
    try { await assertBuddyPairNotBlocked(this.database, invitation.inviterUserId, invitation.inviteeUserId); }
    catch (error) { if (error instanceof ApplicationError && [403, 404].includes(error.statusCode)) return "TARGET_BLOCKED"; throw error; }
    const preferences = await new BuddyNotificationPreferenceService(this.database).get(invitation.inviteeUserId);
    return !preferences.enabled || preferences.disabledCategories.includes("invitations") ? "PREFERENCE_DISABLED" : undefined;
  }

  private isUnknown(error: unknown) {
    return error instanceof TypeError || error instanceof SyntaxError || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
  }

  private isRetryable(error: unknown) {
    if (this.isUnknown(error)) return false;
    if (!(error instanceof ApplicationError)) return true;
    if (error.code === "EMAIL_SERVICE_NOT_CONFIGURED") return false;
    return error.statusCode >= 500 || error.statusCode === 429;
  }

  private errorCode(error: unknown) {
    if (this.isUnknown(error)) return "PROVIDER_OUTCOME_UNKNOWN";
    return error instanceof ApplicationError ? error.code : "EMAIL_PROVIDER_REQUEST_FAILED";
  }

  private backoffMs(attempt: number) {
    return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
  }
}

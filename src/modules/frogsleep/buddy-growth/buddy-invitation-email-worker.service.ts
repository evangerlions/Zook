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
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= startedAt) {
      await this.database.updateFrogSleepBuddyInvitationEmailDelivery(delivery.id, {
        status: "suppressed",
        attemptCount: delivery.attemptCount,
        lastErrorCode: !invitation ? "TARGET_REVOKED" : "TARGET_TERMINAL",
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

  private isRetryable(error: unknown) {
    if (!(error instanceof ApplicationError)) return true;
    if (error.code === "EMAIL_SERVICE_NOT_CONFIGURED") return false;
    return error.statusCode >= 500 || error.statusCode === 429;
  }

  private errorCode(error: unknown) {
    return error instanceof ApplicationError ? error.code : "EMAIL_PROVIDER_REQUEST_FAILED";
  }

  private backoffMs(attempt: number) {
    return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1));
  }
}

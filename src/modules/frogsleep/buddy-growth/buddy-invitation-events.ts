import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { sanitizeBuddySafeRoute } from "./buddy-privacy.ts";

/** Writes deduplicated, privacy-safe invitation lifecycle events to the transactional outbox. */
export async function enqueueBuddyInvitationEvent(
  database: ApplicationDatabase,
  input: { recipientUserId?: string; invitationId: string; domain: "sleep" | "focus" | "bundle";
    eventType: "invitation_created" | "invitation_accepted" | "invitation_declined" | "invitation_cancelled" },
) {
  if (!input.recipientUserId) return;
  const now = new Date().toISOString();
  await database.enqueueFrogSleepBuddyNotificationOutbox({
    id: randomId("buddy_outbox"), appId: FROGSLEEP_APP_ID, recipientUserId: input.recipientUserId,
    eventType: input.eventType, targetType: "buddy_invitation", targetId: input.invitationId,
    deduplicationKey: `${input.eventType}:${input.invitationId}:${input.domain}:${input.recipientUserId}`,
    safeRoute: sanitizeBuddySafeRoute({
      type: "buddy_invitation", invitation_id: input.invitationId, domain: input.domain,
    }),
    status: "pending", attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now,
  });
}

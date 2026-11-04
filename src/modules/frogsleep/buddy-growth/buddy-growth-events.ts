import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { sanitizeBuddySafeRoute } from "./buddy-privacy.ts";

/** Writes privacy-safe growth events to the transactional notification outbox. */
export async function enqueueBuddyGrowthEvent(
  database: ApplicationDatabase,
  input: {
    recipientUserId: string;
    eventType: string;
    targetType: string;
    targetId: string;
    relationshipId: string;
    deduplicationKey: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await database.enqueueFrogSleepBuddyNotificationOutbox({
    id: randomId("buddy_outbox"), appId: FROGSLEEP_APP_ID,
    recipientUserId: input.recipientUserId, eventType: input.eventType,
    targetType: input.targetType, targetId: input.targetId,
    deduplicationKey: input.deduplicationKey,
    safeRoute: sanitizeBuddySafeRoute({ type: input.targetType,
      relationship_id: input.relationshipId, [routeIdentifierKey(input.targetType)]: input.targetId }),
    status: "pending", attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now,
  });
}

function routeIdentifierKey(type: string) {
  return type === "buddy_weekly_report" ? "report_id" : type === "buddy_milestone" ? "milestone_id"
    : ["buddy_goal", "buddy_joint_goal"].includes(type) ? "goal_id" : "interaction_id";
}

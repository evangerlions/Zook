import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { NotificationService } from "../../../services/notification.service.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { SleepRelationshipService } from "./sleep-relationship.service.ts";

const sleepPushTypes = new Set(["shared_session_invite", "shared_session_interrupted", "shared_session_returned", "morning_summary"]);

export async function sleepPushSuppression(database: ApplicationDatabase, userId: string, payload: Record<string, unknown>) {
  if (!sleepPushTypes.has(String(payload.type)) || typeof payload.relationshipId !== "string") return undefined;
  try {
    const relationship = await new SleepRelationshipService(database).require(userId, payload.relationshipId);
    if (relationship.status !== "active") return "RELATIONSHIP_INACTIVE";
    await assertBuddyDataAuthorized(database, userId, relationship.id,
      payload.type === "morning_summary" ? "daily_summary" : "shared_activity");
  } catch (error) {
    if (error instanceof ApplicationError && [403, 404].includes(error.statusCode)) return "RELATIONSHIP_UNAVAILABLE";
    throw error;
  }
  const preference = (await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
    kind: "guardianship_preference", ownerUserId: userId, relationshipId: payload.relationshipId, limit: 100 }))
    .find(row => row.status !== "buddy_relationship_notifications");
  const settings = preference?.payload ?? {};
  if (settings.mute_for_tonight === true) return "SLEEP_MUTED";
  if (payload.type === "morning_summary" && settings.allow_morning_summary_push === false) return "MORNING_PUSH_DISABLED";
  if (["shared_session_interrupted", "shared_session_returned"].includes(String(payload.type))
    && settings.allow_recovery_nudges === false) return "RECOVERY_PUSH_DISABLED";
  return undefined;
}

export async function queueSleepPush(database: ApplicationDatabase, notifications: NotificationService | undefined,
  userId: string, payload: Record<string, unknown>) {
  if (!notifications || await sleepPushSuppression(database, userId, payload)) return;
  await notifications.queueNotification({ appId: FROGSLEEP_APP_ID, recipientUserId: userId, channel: "push", payload });
}

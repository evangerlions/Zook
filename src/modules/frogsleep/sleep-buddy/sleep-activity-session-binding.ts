import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Binds both participants and terminal retries to one session across local date boundaries. */
export async function sleepActivitySessionBinding(database: ApplicationDatabase,
  userId: string, relationship: FrogSleepEntityRecord, activityId?: string) {
  if (!activityId) return undefined;
  const activity = await database.findFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, activityId);
  const members = [relationship.ownerUserId, relationship.partnerUserId];
  if (!activity || activity.relationshipId !== relationship.id || activity.payload.type !== "tonight_together"
    || ![activity.ownerUserId, activity.partnerUserId].includes(userId)
    || !members.includes(activity.ownerUserId) || !members.includes(activity.partnerUserId)
    || activity.ownerUserId === activity.partnerUserId) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint sleep activity is unavailable.");
  }
  if (!["accepted", "completed"].includes(activity.status ?? "")) {
    conflict("REQ_INVALID_BODY", "Joint sleep activity must be accepted.");
  }
  const id = `sleep_session_joint_${activityId}`;
  const existing = await database.findFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, id);
  if (!existing && (activity.status === "completed" || String(activity.payload.expires_at ?? "") <= new Date().toISOString())) {
    conflict("REQ_INVALID_BODY", "Joint sleep activity is no longer available.");
  }
  return { id, existing };
}

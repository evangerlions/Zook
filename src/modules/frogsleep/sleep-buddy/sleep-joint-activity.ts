import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { allBuddyRecords } from "../buddy-growth/buddy-completion-facts.ts";

/** Resolves a started joint sleep activity independently of either participant's calendar date. */
export async function sleepJointActivity(database: ApplicationDatabase, userId: string, relationshipId: string, id: string) {
  const activity = await database.findFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, id);
  if (!activity || activity.relationshipId !== relationshipId || activity.payload.type !== "tonight_together" ||
    ![activity.ownerUserId, activity.partnerUserId].includes(userId)) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint sleep activity is unavailable.");
  }
  if (!["accepted", "expired", "completed"].includes(activity.status ?? "")) {
    conflict("REQ_INVALID_BODY", "Joint sleep activity is not accepted.");
  }
  const sessions = await allBuddyRecords(database, { kind: "sleep_session", relationshipId });
  const existing = sessions.find(session => session.payload.joint_activity_id === id);
  if (existing) return { activity, existing };
  const starts = activity.payload.participant_started_at as Record<string, string> | undefined;
  if (activity.status !== "accepted" || !starts?.[userId] || String(activity.payload.expires_at ?? "") <= new Date().toISOString()) {
    conflict("REQ_INVALID_BODY", "Start the accepted activity before entering sleep.");
  }
  return { activity, existing: undefined };
}

export async function linkSleepActivitySession(database: ApplicationDatabase, activity: FrogSleepEntityRecord, sessionId: string) {
  await database.updateFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, activity.id, {
    payload: { ...activity.payload, sleep_session_id: sessionId }, updatedAt: new Date().toISOString() });
}

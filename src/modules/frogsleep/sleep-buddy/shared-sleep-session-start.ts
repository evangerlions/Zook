import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { parseIsoTimestamp } from "../frogsleep-validation.ts";
import { allBuddyRecords } from "../buddy-growth/buddy-completion-facts.ts";

/** Resolves one durable shared session per joint activity while retaining legacy day-based entry. */
export async function startSharedSleepSession(database: ApplicationDatabase, userId: string,
  relationship: FrogSleepEntityRecord, anchor?: string, activityId?: string) {
  const day = normalizedSleepDay(anchor);
  const joint = activityId ? await jointSleepActivity(database, userId, relationship.id, activityId) : undefined;
  const existing = joint ? joint.session : await openSessionForDay(database, relationship.id, day);
  if (existing) return { session: existing, created: false };
  const session = newSession(userId, relationship, day, activityId);
  await database.insertFrogSleepEntity(session);
  if (joint) await database.updateFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, joint.activity.id, {
    payload: { ...joint.activity.payload, sleep_session_id: session.id }, updatedAt: session.createdAt });
  return { session, created: true };
}

async function jointSleepActivity(database: ApplicationDatabase, userId: string, relationshipId: string, id: string) {
  const activity = await database.findFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, id);
  if (!activity || activity.relationshipId !== relationshipId || activity.payload.type !== "tonight_together" ||
    ![activity.ownerUserId, activity.partnerUserId].includes(userId)) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint sleep activity is unavailable.");
  }
  if (!["accepted", "expired", "completed"].includes(activity.status ?? "")) {
    conflict("REQ_INVALID_BODY", "Joint sleep activity is not accepted.");
  }
  const sessions = await allBuddyRecords(database, { kind: "sleep_session", relationshipId });
  const session = sessions.find(item => item.payload.joint_activity_id === id);
  if (session) return { activity, session };
  const starts = activity.payload.participant_started_at as Record<string, string> | undefined;
  if (activity.status !== "accepted" || !starts?.[userId] ||
    String(activity.payload.expires_at ?? "") <= new Date().toISOString()) {
    conflict("REQ_INVALID_BODY", "Start the accepted activity before entering sleep.");
  }
  return { activity, session: undefined };
}

async function openSessionForDay(database: ApplicationDatabase, relationshipId: string, day: string) {
  const sessions = await allBuddyRecords(database, { kind: "sleep_session", relationshipId });
  return sessions.find(session => ["active", "pending"].includes(session.status ?? "") &&
    String(session.payload.dateAnchor ?? session.payload.date_anchor ?? session.startsAt ?? session.createdAt).slice(0, 10) === day);
}

function normalizedSleepDay(value?: string) {
  const input = value || new Date().toISOString();
  const day = input.slice(0, 10), parsed = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== day) {
    badRequest("REQ_INVALID_BODY", "date_anchor must identify a valid calendar day.");
  }
  if (input.length > 10) parseIsoTimestamp(input, "date_anchor");
  return day;
}

function newSession(userId: string, relationship: FrogSleepEntityRecord, day: string, activityId?: string): FrogSleepEntityRecord {
  const now = new Date().toISOString();
  const partner = relationship.ownerUserId === userId ? relationship.partnerUserId! : relationship.ownerUserId!;
  return { id: randomId("sleep_session"), appId: FROGSLEEP_APP_ID, kind: "sleep_session", ownerUserId: userId,
    partnerUserId: partner, relationshipId: relationship.id, status: "pending", startsAt: now,
    payload: { dateAnchor: day, date_anchor: day, ...(activityId ? { joint_activity_id: activityId } : {}),
      participantStates: { [userId]: "started", [partner]: "pending" } }, createdAt: now, updatedAt: now };
}

import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

const PRESENCE_FOCUSING_GRACE_MS = 5 * 60 * 1000;
const PRESENCE_RECENT_MS = 2 * 60 * 60 * 1000;
const PRESENCE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_FOCUS_SESSION_STATUSES = new Set(["active", "in_progress", "focusing"]);

export function isActiveFocusSessionStatus(status: string | undefined) {
  return Boolean(status && ACTIVE_FOCUS_SESSION_STATUSES.has(status));
}

export async function deriveFocusPresence(
  database: ApplicationDatabase,
  buddyUserId: string,
  relationshipId: string,
  now: Date,
) {
  const activity = await latestBuddyActivity(database, buddyUserId, relationshipId, now);
  if (!activity) {
    return {
      buddy_user_id: buddyUserId,
      status: "stale",
      updated_at: now.toISOString(),
    };
  }
  const ageMs = now.getTime() - activity.at.getTime();
  const status = activity.isFocusing
    ? "focusing"
    : ageMs <= PRESENCE_RECENT_MS
      ? "recently_active"
      : ageMs <= PRESENCE_STALE_MS
        ? "idle"
        : "stale";
  return {
    buddy_user_id: buddyUserId,
    status,
    updated_at: activity.at.toISOString(),
    active_session_id: activity.activeSession?.id,
    goal_tag: activity.activeSession?.payload.goal_tag ?? activity.activeSession?.payload.goal,
    started_at: activity.activeSession?.startsAt,
    ends_at: activity.activeSession?.endsAt,
  };
}

export function matchesSharedMomentRoom(moment: FrogSleepEntityRecord, roomId?: string) {
  if (!roomId) return true;
  const roomIds = Array.isArray(moment.payload.room_ids)
    ? moment.payload.room_ids.map((item) => String(item))
    : [];
  return moment.relationshipId === roomId ||
    moment.sessionId === roomId ||
    moment.payload.room_id === roomId ||
    moment.payload.session_id === roomId ||
    moment.payload.buddy_session_id === roomId ||
    roomIds.includes(roomId);
}

export function overlapsWindow(record: FrogSleepEntityRecord, from?: string, to?: string) {
  const startsAt = new Date(record.startsAt ?? record.createdAt).getTime();
  const endsAt = new Date(record.endsAt ?? record.startsAt ?? record.createdAt).getTime();
  if (from && endsAt < new Date(from).getTime()) return false;
  if (to && startsAt > new Date(to).getTime()) return false;
  return true;
}

async function latestBuddyActivity(
  database: ApplicationDatabase,
  buddyUserId: string,
  relationshipId: string,
  now: Date,
) {
  const sessions = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_session",
    ownerUserId: buddyUserId,
    limit: 50,
  });
  const messages = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_message",
    relationshipId,
    limit: 50,
  });
  const moments = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_shared_moment",
    relationshipId,
    limit: 50,
  });
  const activeSession = sessions.find((session) => isSessionCurrentlyFocusing(session, now.getTime()));
  if (activeSession) {
    return {
      at: new Date(activeSession.updatedAt ?? activeSession.startsAt ?? activeSession.createdAt),
      isFocusing: true,
      activeSession,
    };
  }
  const candidates = [...sessions, ...messages, ...moments]
    .map((record) => ({ at: new Date(record.endsAt ?? record.occurredAt ?? record.startsAt ?? record.createdAt) }))
    .filter((item) => !Number.isNaN(item.at.getTime()))
    .sort((left, right) => right.at.getTime() - left.at.getTime());
  return candidates[0] ? {
    at: candidates[0].at,
    isFocusing: false,
    activeSession: undefined,
  } : undefined;
}

function isSessionCurrentlyFocusing(session: FrogSleepEntityRecord, now: number) {
  if (isActiveFocusSessionStatus(session.status)) return true;
  if (!session.startsAt || !session.endsAt) return false;
  return new Date(session.startsAt).getTime() <= now &&
    now <= new Date(session.endsAt).getTime() + PRESENCE_FOCUSING_GRACE_MS;
}

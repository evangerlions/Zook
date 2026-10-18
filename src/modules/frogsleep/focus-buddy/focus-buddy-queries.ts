import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { forbidden, tooManyRequests } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { currentUtcWeekStart, paginateRecords, parseDateWindow, parseWeekStart, type PaginationParams } from "../frogsleep-validation.ts";
import { toFocusSessionResponse, toFocusAchievementResponse } from "./focus-buddy-mappers.ts";
import { buildFocusWeekStats } from "./focus-buddy-stats.ts";
import { relationshipsForFocusUser, otherFocusUserId, focusSessionsOverlap } from "./focus-buddy-records.ts";
import { deriveFocusPresence, matchesSharedMomentRoom, overlapsWindow } from "./focus-buddy-presence.ts";
import { unlockFocusMilestone } from "./focus-buddy-achievements.ts";
const MESSAGE_RATE_LIMIT_MS = 30 * 60 * 1000;
const nowIso = () => new Date().toISOString();

/** Reads focus buddy facts through the unified relationship projection and deduplicates overlap artifacts. */
export class FocusBuddyQueries {
  constructor(private readonly database: ApplicationDatabase) {}
  async sessions(userId: string, from?: string, to?: string, pagination?: PaginationParams) {
    const sessions = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      startsAtFromIso: from,
      startsAtToIso: to,
      limit: 500,
    });
    const page = paginateRecords(sessions, pagination ?? { limit: 50 });
    return {
      sessions: page.items.map((session) => toFocusSessionResponse(session)),
      pagination: page.pagination,
    };
  }

  async weekStats(userId: string, weekStart?: string) {
    const dateAnchor = weekStart ?? currentUtcWeekStart(this.clock());
    const since = `${dateAnchor}T00:00:00.000Z`;
    const until = new Date(new Date(since).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const sessions = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      startsAtFromIso: since,
      startsAtToIso: until,
      limit: 200,
    });
    return buildFocusWeekStats(sessions, since);
  }

  async achievements(userId: string, pagination?: PaginationParams) {
    const records = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_milestone",
      ownerUserId: userId,
      limit: 500,
    });
    const page = paginateRecords(records, pagination ?? { limit: 50 });
    return {
      achievements: page.items.map((item) => toFocusAchievementResponse(item)),
      pagination: page.pagination,
    };
  }

  async presence(userId: string, buddyUserId: string) {
    const relationship = await this.acceptedRelationshipBetween(userId, buddyUserId);
    if (!relationship) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
    }
    await assertBuddyDataAuthorized(this.database, userId, relationship.id, "presence");
    return await deriveFocusPresence(this.database, buddyUserId, relationship.id, this.clock());
  }

  async comparison(userId: string, weekStart?: string) {
    const relationship = await this.currentRelationshipRecord(userId);
    if (!relationship) {
      return null;
    }
    await assertBuddyDataAuthorized(this.database, userId, relationship.id, "weekly_trend");
    const parsedWeekStart = parseWeekStart(weekStart);
    const buddyUserId = otherFocusUserId(relationship, userId);
    const mine = await this.weekStats(userId, parsedWeekStart);
    const buddy = await this.weekStats(buddyUserId, parsedWeekStart);
    const buddyByDate = new Map(buddy.daily.map((day) => [day.date, day]));
    return {
      buddy_user_id: buddyUserId,
      my_minutes: mine.total_minutes,
      my_sessions: mine.session_count,
      buddy_minutes: buddy.total_minutes,
      buddy_sessions: buddy.session_count,
      buddy_name: buddyUserId,
      trend: mine.total_minutes >= buddy.total_minutes ? "ahead" : "behind",
      daily_breakdown: mine.daily.map((day) => {
        const buddyDay = buddyByDate.get(day.date);
        return {
          date: day.date,
          my_minutes: day.minutes,
          my_sessions: day.session_count,
          buddy_minutes: buddyDay?.minutes ?? 0,
          buddy_sessions: buddyDay?.session_count ?? 0,
        };
      }),
      mine,
      buddy,
    };
  }

  async sharedMoments(userId: string, pagination?: PaginationParams, filters: { roomId?: string; from?: string; to?: string } = {}) {
    const window = parseDateWindow({ from: filters.from, to: filters.to });
    const relationships = await relationshipsForFocusUser(this.database, userId, ["accepted"]);
    const records: FrogSleepEntityRecord[] = [];
    for (const relationship of relationships) {
      await assertBuddyDataAuthorized(this.database, userId, relationship.id, "shared_activity");
      records.push(...await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "focus_shared_moment",
        relationshipId: relationship.id,
        limit: 500,
      }));
    }
    const filtered = records
      .filter((item) => matchesSharedMomentRoom(item, filters.roomId))
      .filter((item) => overlapsWindow(item, window.from, window.to));
    const page = paginateRecords(filtered, pagination ?? { limit: 50 });
    return {
      moments: page.items.map((item) => item.payload),
      pagination: page.pagination,
    };
  }

  async detectSharedMoment(session: FrogSleepEntityRecord) {
    const relationship = await this.currentRelationshipRecord(session.ownerUserId as string);
    if (!relationship || relationship.status !== "accepted") {
      return;
    }
    const buddyUserId = otherFocusUserId(relationship, session.ownerUserId as string);
    const buddySessions = (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: buddyUserId,
      limit: 100,
    })).filter((item) => focusSessionsOverlap(session, item));
    if (!buddySessions[0]) {
      return;
    }
    const existing = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "focus_shared_moment", relationshipId: relationship.id, limit: 500 });
    if (existing.some(item => [item.payload.session_id, item.payload.buddy_session_id].includes(session.id) &&
      [item.payload.session_id, item.payload.buddy_session_id].includes(buddySessions[0].id))) return;
    const createdAt = nowIso();
    await this.database.insertFrogSleepEntity({
      id: randomId("focus_shared_moment"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_shared_moment",
      ownerUserId: session.ownerUserId,
      partnerUserId: buddyUserId,
      relationshipId: relationship.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: "detected",
      payload: {
        session_id: session.id,
        buddy_session_id: buddySessions[0].id,
        room_id: session.payload.room_id ?? session.payload.room ?? buddySessions[0].payload.room_id ?? buddySessions[0].payload.room,
        room_ids: [session.payload.room_id ?? session.payload.room, buddySessions[0].payload.room_id ?? buddySessions[0].payload.room]
          .filter(Boolean),
      },
      createdAt,
      updatedAt: createdAt,
    });
    await unlockFocusMilestone(this.database, session.ownerUserId as string, "buddy_shared_moment");
    await unlockFocusMilestone(this.database, buddyUserId, "buddy_shared_moment");
  }

  async assertMessageRateLimit(userId: string, receiverUserId: string) {
    const recentMessages = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_message",
      ownerUserId: userId,
      partnerUserId: receiverUserId,
      limit: 20,
    });
    const now = Date.now();
    const latest = recentMessages.find((item) => now - new Date(item.createdAt).getTime() < MESSAGE_RATE_LIMIT_MS);
    if (!latest) {
      return;
    }
    const elapsedMs = now - new Date(latest.createdAt).getTime();
    tooManyRequests("AUTH_RATE_LIMITED", "Focus buddy message rate limit reached.", {
      retry_after_seconds: Math.ceil((MESSAGE_RATE_LIMIT_MS - elapsedMs) / 1000),
    });
  }
  private async currentRelationshipRecord(userId: string) {
    return (await relationshipsForFocusUser(this.database, userId, ["accepted"]))[0];
  }
  private async acceptedRelationshipBetween(userId: string, buddyId: string) {
    return (await relationshipsForFocusUser(this.database, userId, ["accepted"]))
      .find(item => otherFocusUserId(item, userId) === buddyId);
  }
  private clock() { return new Date(); }
}

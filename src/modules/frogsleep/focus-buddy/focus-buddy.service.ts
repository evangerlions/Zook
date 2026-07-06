import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, forbidden, tooManyRequests } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import {
  currentUtcWeekStart,
  optionalIsoTimestamp,
  paginateRecords,
  parseDateWindow,
  parseFiniteNumber,
  parseIsoTimestamp,
  parseWeekStart,
  type PaginationParams,
} from "../frogsleep-validation.ts";
import {
  findFocusMilestone,
  unlockFocusMilestone,
} from "./focus-buddy-achievements.ts";
import {
  acceptFocusInviteByCode,
  acceptFocusInviteByToken,
  createFocusInvite,
  excludedFocusMatchUserIds,
  previewFocusInvite,
  recordFocusMatchFeedback,
  refreshFocusInviteRelationships,
  trackFocusInviteOpenByToken,
} from "./focus-buddy-invites.ts";
import {
  buildFocusMatchProfilePayload,
  buildFocusMatchSearchResult,
  hasMatchingConsent,
} from "./focus-match-ranking.ts";
import { validateFocusMessagePayload } from "./focus-buddy-message-validation.ts";
import {
  focusSessionsOverlap,
  otherFocusUserId,
  relationshipsForFocusUser,
} from "./focus-buddy-records.ts";
import {
  deriveFocusPresence,
  isActiveFocusSessionStatus,
  matchesSharedMomentRoom,
  overlapsWindow,
} from "./focus-buddy-presence.ts";
import {
  toFocusAchievementResponse,
  toFocusMessageResponse,
  toFocusProfileResponse,
  toFocusRelationshipResponse,
  toFocusSessionResponse,
} from "./focus-buddy-mappers.ts";
import { buildFocusWeekStats } from "./focus-buddy-stats.ts";

const MESSAGE_RATE_LIMIT_MS = 30 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

const FOCUS_SESSION_STATUSES = new Set(["completed", "abandoned", "interrupted", "cancelled"]);
const MAX_FOCUS_SESSION_MINUTES = 24 * 60;

export class FrogSleepFocusBuddyService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly notificationService?: NotificationService,
  ) {}

  async reportSession(userId: string, input: Record<string, unknown>) {
    const startedAt = parseIsoTimestamp(input.started_at ?? input.startedAt ?? input.start_time ?? input.startTime ?? nowIso(), "started_at");
    const endedAt = parseIsoTimestamp(input.ended_at ?? input.endedAt ?? input.end_time ?? input.endTime ?? nowIso(), "ended_at");
    if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
      badRequest("REQ_INVALID_BODY", "ended_at must be after started_at.");
    }
    const room = input.room ?? input.room_id ?? input.roomId;
    const goal = input.goal ?? input.goal_tag ?? input.goalTag;
    const plannedMinutes = parseFiniteNumber(input.planned_minutes ?? input.plannedMinutes ?? input.minutes ?? 0, "planned_minutes", {
      min: 0,
      max: MAX_FOCUS_SESSION_MINUTES,
    });
    const actualMinutes = parseFiniteNumber(input.actual_minutes ?? input.actualMinutes ?? input.minutes ?? minutesBetween(startedAt, endedAt), "actual_minutes", {
      min: 0,
      max: MAX_FOCUS_SESSION_MINUTES,
    });
    const interruptCount = parseFiniteNumber(input.interrupt_count ?? input.interruptCount ?? 0, "interrupt_count", {
      min: 0,
      max: 1000,
    });
    const status = String(input.status ?? "completed");
    if (!FOCUS_SESSION_STATUSES.has(status) && !isActiveFocusSessionStatus(status)) {
      badRequest("REQ_INVALID_BODY", "Unsupported focus session status.");
    }
    const createdAt = nowIso();
    const session: FrogSleepEntityRecord = {
      id: randomId("focus_session"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      status,
      startsAt: startedAt,
      endsAt: endedAt,
      payload: {
        client_session_id: input.session_id ?? input.sessionId,
        room,
        room_id: room,
        goal,
        goal_tag: goal,
        planned_minutes: plannedMinutes,
        actual_minutes: actualMinutes,
        interrupt_count: interruptCount,
        minutes: actualMinutes,
        session_type: input.session_type ?? input.sessionType,
        result: input.result,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(session);
    await unlockFocusMilestone(this.database, userId, "first_session");
    await this.detectSharedMoment(session);
    return toFocusSessionResponse(session);
  }

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

  async notifyAchievement(userId: string, milestoneId: string) {
    const record = await findFocusMilestone(this.database, userId, milestoneId) ??
      await unlockFocusMilestone(this.database, userId, milestoneId);
    const updated = await this.database.updateFrogSleepEntity("focus_milestone", FROGSLEEP_APP_ID, record.id, {
      payload: {
        ...record.payload,
        notified: true,
      },
    });
    await this.queuePush(userId, buildFrogSleepNotificationPayload({
      type: "focus_achievement",
      entityId: record.id,
      data: {
        milestone_id: milestoneId,
      },
    }));
    return updated?.payload;
  }

  async saveProfile(userId: string, input: Record<string, unknown>) {
    const displayName = String(input.display_name ?? input.displayName ?? "").trim();
    if (!displayName) {
      badRequest("REQ_INVALID_BODY", "display_name is required.");
    }
    const existing = await this.getProfileRecord(userId);
    const payload = buildFocusMatchProfilePayload(displayName, input);
    if (existing) {
      const updated = await this.database.updateFrogSleepEntity("focus_profile", FROGSLEEP_APP_ID, existing.id, {
        status: "active",
        payload,
      });
      return toFocusProfileResponse(updated as FrogSleepEntityRecord);
    }
    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("focus_profile"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_profile",
      ownerUserId: userId,
      status: "active",
      payload,
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(record);
    return toFocusProfileResponse(record);
  }

  async getProfile(userId: string) {
    const record = await this.getProfileRecord(userId);
    return record ? toFocusProfileResponse(record) : null;
  }

  async deleteProfile(userId: string) {
    const record = await this.getProfileRecord(userId);
    if (!record) {
      return { deleted: false };
    }
    await this.database.updateFrogSleepEntity("focus_profile", FROGSLEEP_APP_ID, record.id, {
      status: "inactive",
      deletedAt: nowIso(),
    });
    return { deleted: true };
  }

  async searchMatches(userId: string, limit = 20) {
    const myProfile = await this.getProfileRecord(userId);
    if (!myProfile) {
      badRequest("REQ_INVALID_BODY", "Match profile is required before searching.");
    }
    if (!hasMatchingConsent(myProfile)) {
      badRequest("REQ_INVALID_BODY", "Matching consent is required before searching.");
    }
    const relationships = (await refreshFocusInviteRelationships(
      this.database,
      await relationshipsForFocusUser(this.database, userId, ["pending", "accepted"]),
    )).filter((item) => item.status === "pending" || item.status === "accepted");
    const pendingOutgoing = relationships.find((item) => item.status === "pending" && item.ownerUserId === userId);
    if (pendingOutgoing) {
      return {
        candidates: [],
        empty_state: {
          reason: "pending_invites",
          title_key: "buddy_match.empty.pending_invites.title",
          subtitle_key: "buddy_match.empty.pending_invites.subtitle",
          pending_relationship_id: pendingOutgoing.id,
          pending_user_id: otherFocusUserId(pendingOutgoing, userId),
        },
        pagination: {
          limit,
          next_cursor: null,
          has_more: false,
        },
      };
    }
    const candidates = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_profile",
      status: "active",
      limit: 200,
    });
    const excluded = new Set(relationships.map((item) => otherFocusUserId(item, userId)));
    const feedbackExcluded = await excludedFocusMatchUserIds(
      this.database,
      userId,
      candidates.map((item) => item.ownerUserId).filter(Boolean) as string[],
    );
    for (const excludedUserId of feedbackExcluded) {
      excluded.add(excludedUserId);
    }
    const result = buildFocusMatchSearchResult(myProfile, candidates, excluded, limit);
    return {
      ...result,
      pagination: {
        limit,
        next_cursor: null,
        has_more: false,
      },
    };
  }

  async invite(userId: string, target: string, focusInviteBaseUrl = "frogsleep://focus-invite") {
    return await createFocusInvite(this.deps(), userId, target, focusInviteBaseUrl);
  }

  async acceptInviteByCode(userId: string, code: string) {
    return await acceptFocusInviteByCode(this.deps(), userId, code);
  }

  async acceptInviteByToken(userId: string, token: string) {
    return await acceptFocusInviteByToken(this.deps(), userId, token);
  }

  async trackInviteOpenByToken(token: string, userAgent?: string) {
    await trackFocusInviteOpenByToken(this.deps(), token, userAgent);
  }

  async previewInvite(userId: string, input: { token?: string; code?: string }) {
    return await previewFocusInvite(this.deps(), userId, input);
  }

  async recordMatchFeedback(
    userId: string,
    targetUserId: string,
    action: "dismissed" | "reported",
    input: Record<string, unknown>,
  ) {
    return await recordFocusMatchFeedback(this.deps(), userId, targetUserId, action, input);
  }

  async currentRelationship(userId: string) {
    const relationships = await relationshipsForFocusUser(this.database, userId, ["accepted"]);
    return relationships[0] ? toFocusRelationshipResponse(relationships[0], userId) : null;
  }

  async relationshipAction(userId: string, relationshipId: string, action: string) {
    const relationship = await this.requireRelationship(userId, relationshipId);
    if (action !== "accept" && action !== "decline" && action !== "revoke") {
      badRequest("REQ_INVALID_BODY", "Unsupported focus relationship action.");
    }
    const status = this.nextRelationshipStatus(relationship.status, action);
    const updated = await this.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationship.id, {
      status,
    });
    return toFocusRelationshipResponse(updated as FrogSleepEntityRecord, userId);
  }

  async sendMessage(userId: string, input: Record<string, unknown>) {
    const receiverUserId = String(input.receiver_user_id ?? input.receiverUserId ?? "");
    validateFocusMessagePayload(input);
    const relationship = await this.acceptedRelationshipBetween(userId, receiverUserId);
    if (!relationship) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
    }
    await this.assertMessageRateLimit(userId, receiverUserId);
    const createdAt = nowIso();
    const message: FrogSleepEntityRecord = {
      id: randomId("focus_message"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_message",
      ownerUserId: userId,
      partnerUserId: receiverUserId,
      relationshipId: relationship.id,
      status: "sent",
      payload: {
        template_key: input.template_key ?? input.templateKey,
        custom_text: input.custom_text ?? input.customText,
        context_session_type: input.context_session_type ?? input.contextSessionType,
        context_session_id: input.context_session_id ?? input.contextSessionId,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(message);
    return toFocusMessageResponse(message);
  }

  async messages(userId: string, pagination?: PaginationParams, filters: { buddyUserId?: string; since?: string } = {}) {
    if (filters.buddyUserId && !await this.acceptedRelationshipBetween(userId, filters.buddyUserId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
    }
    const owned = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_message",
      ownerUserId: userId,
      partnerUserId: filters.buddyUserId,
      limit: 500,
    });
    const received = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_message",
      partnerUserId: userId,
      ownerUserId: filters.buddyUserId,
      limit: 500,
    });
    const since = optionalIsoTimestamp(filters.since, "since");
    const records = [...owned, ...received].filter((item) => since ? item.createdAt > since : true);
    const page = paginateRecords(records, pagination ?? { limit: 50 });
    return {
      messages: page.items.map((item) => toFocusMessageResponse(item)),
      pagination: page.pagination,
    };
  }

  async presence(userId: string, buddyUserId: string) {
    const relationship = await this.acceptedRelationshipBetween(userId, buddyUserId);
    if (!relationship) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
    }
    return await deriveFocusPresence(this.database, buddyUserId, relationship.id, this.clock());
  }

  async comparison(userId: string, weekStart?: string) {
    const relationship = await this.currentRelationshipRecord(userId);
    if (!relationship) {
      return null;
    }
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

  private nextRelationshipStatus(currentStatus: string | undefined, action: string): string {
    if (currentStatus === "revoked") {
      badRequest("REQ_INVALID_BODY", "Revoked focus relationship cannot be changed.");
    }
    if (action === "accept" && currentStatus === "pending") {
      return "accepted";
    }
    if (action === "decline" && currentStatus === "pending") {
      return "declined";
    }
    if (action === "revoke" && (currentStatus === "accepted" || currentStatus === "pending")) {
      return "revoked";
    }
    badRequest("REQ_INVALID_BODY", "Focus relationship action is not valid for the current status.");
  }

  private async getProfileRecord(userId: string) {
    return (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_profile",
      ownerUserId: userId,
      status: "active",
      limit: 1,
    }))[0];
  }

  private async queuePush(userId: string, payload: Record<string, unknown>) {
    if (!this.notificationService) {
      return;
    }
    await this.notificationService.queueNotification({
      appId: FROGSLEEP_APP_ID,
      recipientUserId: userId,
      channel: "push",
      payload,
    });
  }

  private async detectSharedMoment(session: FrogSleepEntityRecord) {
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

  private async currentRelationshipRecord(userId: string) {
    return (await relationshipsForFocusUser(this.database, userId, ["accepted"]))[0];
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    const relationship = await this.database.findFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationshipId);
    if (!relationship || (relationship.ownerUserId !== userId && relationship.partnerUserId !== userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Relationship is not visible to the current user.");
    }
    return relationship;
  }

  private async acceptedRelationshipBetween(userA: string, userB: string) {
    return (await relationshipsForFocusUser(this.database, userA, ["accepted"]))
      .find((item) => otherFocusUserId(item, userA) === userB);
  }

  private async assertMessageRateLimit(userId: string, receiverUserId: string) {
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

  private deps() {
    return {
      database: this.database,
      notificationService: this.notificationService,
    };
  }

  private clock() {
    return new Date();
  }

}

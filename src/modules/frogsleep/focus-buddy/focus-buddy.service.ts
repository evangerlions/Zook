import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, conflict, forbidden, tooManyRequests } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import {
  buildFocusMatchProfilePayload,
  buildFocusMatchSearchResult,
  hasMatchingConsent,
} from "./focus-match-ranking.ts";
import {
  toFocusAchievementResponse,
  toFocusMessageResponse,
  toFocusProfileResponse,
  toFocusRelationshipResponse,
  toFocusSessionResponse,
} from "./focus-buddy-mappers.ts";
import { buildFocusWeekStats } from "./focus-buddy-stats.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MESSAGE_RATE_LIMIT_MS = 30 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultInviteExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + INVITE_TTL_MS).toISOString();
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

export class FrogSleepFocusBuddyService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly notificationService?: NotificationService,
  ) {}

  async reportSession(userId: string, input: Record<string, unknown>) {
    const startedAt = String(input.started_at ?? input.startedAt ?? input.start_time ?? input.startTime ?? nowIso());
    const endedAt = String(input.ended_at ?? input.endedAt ?? input.end_time ?? input.endTime ?? nowIso());
    const room = input.room ?? input.room_id ?? input.roomId;
    const goal = input.goal ?? input.goal_tag ?? input.goalTag;
    const plannedMinutes = Number(input.planned_minutes ?? input.plannedMinutes ?? input.minutes ?? 0);
    const actualMinutes = Number(input.actual_minutes ?? input.actualMinutes ?? input.minutes ?? minutesBetween(startedAt, endedAt));
    const createdAt = nowIso();
    const session: FrogSleepEntityRecord = {
      id: randomId("focus_session"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      status: String(input.status ?? "completed"),
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
        interrupt_count: Number(input.interrupt_count ?? input.interruptCount ?? 0),
        minutes: actualMinutes,
        session_type: input.session_type ?? input.sessionType,
        result: input.result,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(session);
    await this.unlockMilestone(userId, "first_session");
    await this.detectSharedMoment(session);
    return toFocusSessionResponse(session);
  }

  async sessions(userId: string, from?: string, to?: string) {
    const sessions = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      startsAtFromIso: from,
      startsAtToIso: to,
      limit: 200,
    });
    return sessions.map((session) => toFocusSessionResponse(session));
  }

  async weekStats(userId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sessions = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      startsAtFromIso: since,
      limit: 200,
    });
    return buildFocusWeekStats(sessions, since);
  }

  async achievements(userId: string) {
    const records = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_milestone",
      ownerUserId: userId,
      limit: 100,
    });
    return records.map((item) => toFocusAchievementResponse(item));
  }

  async notifyAchievement(userId: string, milestoneId: string) {
    const record = await this.findMilestone(userId, milestoneId) ?? await this.unlockMilestone(userId, milestoneId);
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
    const candidates = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_profile",
      status: "active",
      limit: 200,
    });
    const relationships = await this.relationshipsForUser(userId, ["pending", "accepted"]);
    const excluded = new Set(relationships.map((item) => this.otherUserId(item, userId)));
    return buildFocusMatchSearchResult(myProfile, candidates, excluded, limit);
  }

  async invite(userId: string, target: string, focusInviteBaseUrl = "frogsleep://focus-invite") {
    const targetUser = await this.resolveUser(target);
    if (!targetUser || targetUser.id === userId) {
      badRequest("REQ_INVALID_BODY", "Target user is invalid.");
    }
    await this.assertNoFocusConflict(userId, targetUser.id);
    const createdAt = nowIso();
    const code = randomCode();
    const token = randomId("focus_invite_token");
    const relationship: FrogSleepEntityRecord = {
      id: randomId("focus_relationship"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_relationship",
      ownerUserId: userId,
      partnerUserId: targetUser.id,
      status: "pending",
      payload: {},
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(relationship);
    const expiresAt = defaultInviteExpiresAt(createdAt);
    const invite: FrogSleepEntityRecord = {
      id: randomId("focus_invite"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_invite",
      ownerUserId: userId,
      partnerUserId: targetUser.id,
      relationshipId: relationship.id,
      status: "pending",
      code,
      token,
      payload: {
        shareLink: `${focusInviteBaseUrl}?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
        shareTitle: "专注搭子邀请",
        shareSubtitle: "一起完成下一次专注",
        expires_at: expiresAt,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(invite);
    await this.queuePush(targetUser.id, buildFrogSleepNotificationPayload({
      type: "focus_buddy_invite",
      entityId: invite.id,
      relationshipId: relationship.id,
    }));
    return toFocusRelationshipResponse(relationship, userId, invite);
  }

  async acceptInviteByCode(userId: string, code: string) {
    const invite = await this.database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, code);
    return await this.acceptInvite(userId, invite);
  }

  async acceptInviteByToken(userId: string, token: string) {
    const invite = await this.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, token);
    return await this.acceptInvite(userId, invite);
  }

  async currentRelationship(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["accepted"]);
    return relationships[0] ? toFocusRelationshipResponse(relationships[0], userId) : null;
  }

  async relationshipAction(userId: string, relationshipId: string, action: string) {
    const relationship = await this.requireRelationship(userId, relationshipId);
    if (action !== "accept" && action !== "decline" && action !== "revoke") {
      badRequest("REQ_INVALID_BODY", "Unsupported focus relationship action.");
    }
    const status = action === "accept" ? "accepted" : action === "decline" ? "declined" : "revoked";
    const updated = await this.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationship.id, {
      status,
    });
    return toFocusRelationshipResponse(updated as FrogSleepEntityRecord, userId);
  }

  async sendMessage(userId: string, input: Record<string, unknown>) {
    const receiverUserId = String(input.receiver_user_id ?? input.receiverUserId ?? "");
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

  async messages(userId: string) {
    const owned = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_message",
      ownerUserId: userId,
      limit: 100,
    });
    const received = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_message",
      partnerUserId: userId,
      limit: 100,
    });
    return [...owned, ...received].map((item) => toFocusMessageResponse(item));
  }

  async presence(userId: string, buddyUserId: string) {
    const relationship = await this.acceptedRelationshipBetween(userId, buddyUserId);
    if (!relationship) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
    }
    return {
      buddy_user_id: buddyUserId,
      status: "idle",
      updated_at: nowIso(),
    };
  }

  async comparison(userId: string) {
    const relationship = await this.currentRelationshipRecord(userId);
    if (!relationship) {
      return null;
    }
    const buddyUserId = this.otherUserId(relationship, userId);
    const mine = await this.weekStats(userId);
    const buddy = await this.weekStats(buddyUserId);
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

  async sharedMoments(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["accepted"]);
    const records: FrogSleepEntityRecord[] = [];
    for (const relationship of relationships) {
      records.push(...await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "focus_shared_moment",
        relationshipId: relationship.id,
        limit: 100,
      }));
    }
    return records.map((item) => item.payload);
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

  private async unlockMilestone(userId: string, milestoneId: string) {
    const existing = await this.findMilestone(userId, milestoneId);
    if (existing) {
      return existing;
    }
    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("focus_milestone"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_milestone",
      ownerUserId: userId,
      status: "unnotified",
      payload: {
        milestone_id: milestoneId,
        unlocked: true,
        notified: false,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(record);
    return record;
  }

  private async findMilestone(userId: string, milestoneId: string) {
    const records = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_milestone",
      ownerUserId: userId,
      limit: 100,
    });
    return records.find((item) => item.payload.milestone_id === milestoneId);
  }

  private async detectSharedMoment(session: FrogSleepEntityRecord) {
    const relationship = await this.currentRelationshipRecord(session.ownerUserId as string);
    if (!relationship) {
      return;
    }
    const buddyUserId = this.otherUserId(relationship, session.ownerUserId as string);
    const buddySessions = (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: buddyUserId,
      limit: 100,
    })).filter((item) => this.overlaps(session, item));
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
      },
      createdAt,
      updatedAt: createdAt,
    });
    await this.unlockMilestone(session.ownerUserId as string, "buddy_shared_moment");
    await this.unlockMilestone(buddyUserId, "buddy_shared_moment");
  }

  private async resolveUser(value: string) {
    if (value.includes("@")) {
      return await this.database.findUserByAccount(value);
    }
    return await this.database.findUserById(value);
  }

  private overlaps(left: FrogSleepEntityRecord, right: FrogSleepEntityRecord): boolean {
    if (!left.startsAt || !left.endsAt || !right.startsAt || !right.endsAt) {
      return false;
    }
    return new Date(left.startsAt).getTime() < new Date(right.endsAt).getTime() &&
      new Date(right.startsAt).getTime() < new Date(left.endsAt).getTime();
  }

  private async assertNoFocusConflict(userA: string, userB: string) {
    const relationships = await this.relationshipsForUser(userA, ["pending", "accepted"]);
    if (relationships.some((item) => this.otherUserId(item, userA) === userB)) {
      conflict("REQ_INVALID_BODY", "A focus buddy relationship already exists.");
    }
  }

  private async relationshipsForUser(userId: string, statuses: string[]) {
    const owned = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_relationship",
      ownerUserId: userId,
      limit: 100,
    });
    const partnered = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_relationship",
      partnerUserId: userId,
      limit: 100,
    });
    return [...owned, ...partnered].filter((item) => item.status && statuses.includes(item.status));
  }

  private async currentRelationshipRecord(userId: string) {
    return (await this.relationshipsForUser(userId, ["accepted"]))[0];
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    const relationship = await this.database.findFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationshipId);
    if (!relationship || (relationship.ownerUserId !== userId && relationship.partnerUserId !== userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Relationship is not visible to the current user.");
    }
    return relationship;
  }

  private async acceptedRelationshipBetween(userA: string, userB: string) {
    return (await this.relationshipsForUser(userA, ["accepted"]))
      .find((item) => this.otherUserId(item, userA) === userB);
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

  private async acceptInvite(userId: string, invite?: FrogSleepEntityRecord) {
    const currentInvite = invite ? await this.refreshInviteStatus(invite) : undefined;
    if (currentInvite?.status === "expired") {
      badRequest("REQ_INVALID_BODY", "Invite has expired.");
    }
    if (!currentInvite || currentInvite.status !== "pending" || !currentInvite.relationshipId) {
      badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    }
    if (currentInvite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "This invite is not for the current user.");
    }
    const relationship = await this.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, currentInvite.relationshipId, {
      status: "accepted",
    });
    await this.database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, currentInvite.id, {
      status: "accepted",
    });
    return toFocusRelationshipResponse(relationship as FrogSleepEntityRecord, userId);
  }

  private async refreshInviteStatus(invite: FrogSleepEntityRecord) {
    if (invite.status !== "pending" || !this.isInviteExpired(invite)) {
      return invite;
    }
    if (invite.relationshipId) {
      await this.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, invite.relationshipId, {
        status: "expired",
      });
    }
    return await this.database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, invite.id, {
      status: "expired",
    }) as FrogSleepEntityRecord;
  }

  private isInviteExpired(invite: FrogSleepEntityRecord): boolean {
    const expiresAt = invite.payload.expires_at ?? invite.payload.expiresAt;
    return typeof expiresAt === "string" && new Date(expiresAt).getTime() <= Date.now();
  }

  private otherUserId(record: FrogSleepEntityRecord, userId: string): string {
    return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
  }

}

import { recordFocusSharedMoment, viewerFocusMoment } from "./focus-shared-moment.ts";
import { findBuddyRelationship } from "../buddy-growth/buddy-relationship-facts.ts";
import { BuddyRelationshipLifecycleService } from "../buddy-growth/buddy-relationship-lifecycle.service.ts";
import { buildFocusSessionReport } from "./focus-session-report.ts";
import { buildFocusSessionUpload } from "./focus-session-upload.ts";
import { allBuddyRecords } from "../buddy-growth/buddy-completion-facts.ts";
import { BuddyJointActivityService } from "../buddy-growth/buddy-joint-activity.service.ts";
import { BuddyJointGoalService } from "../buddy-growth/buddy-joint-goal.service.ts";
import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { ContentSafetyService } from "../../../services/content-safety.service.ts";
import type { ContentSafetyCheckCommand } from "../../../services/content-safety-types.ts";
import { badRequest, conflict, forbidden, tooManyRequests } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { assertBuddyDataAuthorized, authorizedFocusMessageRelationshipIds } from "../buddy-growth/buddy-protected-access.ts";
import {
  currentUtcWeekStart,
  optionalIsoTimestamp,
  paginateRecords,
  parseDateWindow,
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
  focusInviteAction,
  pendingFocusInvites,
  previewFocusInvite,
  recordFocusMatchFeedback,
  trackFocusInviteOpenByToken,
} from "./focus-buddy-invites.ts";
import { buildFocusMatchProfilePayload } from "./focus-match-ranking.ts";
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
import { searchFocusMatches } from "./focus-buddy-matching.ts";

const MESSAGE_RATE_LIMIT_MS = 30 * 60 * 1000;
function nowIso(): string {
  return new Date().toISOString();
}

export class FrogSleepFocusBuddyService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly notificationService?: NotificationService,
    private readonly contentSafetyService?: ContentSafetyService,
  ) {}

  private async assertTextAllowed(userId: string, text: string, taskType: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || !this.contentSafetyService) return;
    const command: ContentSafetyCheckCommand = {
      appId: FROGSLEEP_APP_ID,
      userId,
      taskType,
      text: trimmed,
    };
    // Throws ApplicationError(422, "AI_INPUT_CONTENT_SENSITIVE", ...) on block.
    await this.contentSafetyService.assertUserInputAllowed(command);
  }

  async reportSession(userId: string, input: Record<string, unknown>) {
    const result = await this.database.withAppUserDataTransaction(FROGSLEEP_APP_ID, userId, async () => {
      if ((await this.database.findAppUser(FROGSLEEP_APP_ID, userId))?.status !== "ACTIVE") {
        forbidden("APP_MEMBER_DELETED", "The app membership is not active.");
      }
      buildFocusSessionUpload(userId, input);
      const candidate = buildFocusSessionReport(userId, input);
      const clientId = candidate.payload.client_session_id;
      if (typeof clientId === "string") {
        const previous = await this.database.findFrogSleepPersonalRecord("focus_session", userId, clientId);
        if (previous && (input.binding !== undefined || previous.payload._confirmed_import === true)
          && previous.payload._report_fingerprint !== candidate.payload._report_fingerprint) {
          conflict("REQ_INVALID_BODY", "A confirmed imported result cannot be overwritten.");
        }
        if (input.binding !== undefined || previous?.payload._confirmed_import === true) candidate.payload._confirmed_import = true;
      }
      const saved = clientId === undefined
        ? await this.insertLegacySession(candidate)
        : await this.database.upsertFrogSleepFocusSession(candidate);
      if (saved.inserted) await unlockFocusMilestone(this.database, userId, "first_session");
      return saved;
    });
    await recordFocusSharedMoment(this.database, result.record).catch(() => undefined);
    await new BuddyJointActivityService(this.database).refresh(userId).catch(() => undefined);
    await new BuddyJointGoalService(this.database).list(userId).catch(() => undefined);
    return toFocusSessionResponse(result.record);
  }

  private async insertLegacySession(record: FrogSleepEntityRecord) {
    await this.database.insertFrogSleepEntity(record);
    return { record, inserted: true };
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
    const dateAnchor = parseWeekStart(weekStart) ?? currentUtcWeekStart(this.clock());
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
    await this.assertTextAllowed(userId, displayName, "focus_match_profile.display_name");
    const bio = String(input.bio ?? "").trim();
    if (bio) {
      await this.assertTextAllowed(userId, bio, "focus_match_profile.bio");
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
    return searchFocusMatches(this.database, userId, myProfile, limit);
  }

  async invite(userId: string, target: string, focusInviteBaseUrl = "frogsleep://focus-invite", bundleId?: string) {
    return await createFocusInvite(this.deps(), userId, target, focusInviteBaseUrl, bundleId);
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

  async pendingInvites(userId: string) {
    return pendingFocusInvites(this.deps(), userId);
  }

  async inviteAction(userId: string, inviteId: string, action: "decline" | "cancel") {
    return focusInviteAction(this.deps(), userId, inviteId, action);
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
    if (action === "revoke" && ["accepted", "active", "paused"].includes(relationship.status ?? "")) {
      await new BuddyRelationshipLifecycleService(this.database).execute(userId, relationshipId, "revoke");
      const revoked = await findBuddyRelationship(this.database, relationshipId);
      return toFocusRelationshipResponse(revoked as FrogSleepEntityRecord, userId);
    }
    if (relationship.payload.canonical) badRequest("REQ_INVALID_BODY", "Use invitation decisions for canonical relationships.");
    const status = this.nextRelationshipStatus(relationship.status, action);
    const updated = await this.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationship.id, {
      status,
    });
    return toFocusRelationshipResponse(updated as FrogSleepEntityRecord, userId);
  }

  async sendMessage(userId: string, input: Record<string, unknown>) {
    const receiverUserId = String(input.receiver_user_id ?? input.receiverUserId ?? "");
    validateFocusMessagePayload(input);
    const customText = String(input.custom_text ?? input.customText ?? "").trim();
    if (customText) {
      await this.assertTextAllowed(userId, customText, "focus_message.custom_text");
    }
    const relationship = await this.acceptedRelationshipBetween(userId, receiverUserId);
    if (!relationship) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Accepted focus buddy relationship is required.");
    }
    await assertBuddyDataAuthorized(this.database, userId, relationship.id, "shared_activity");
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
    const authorizedRelationshipIds = await authorizedFocusMessageRelationshipIds(this.database, userId, filters.buddyUserId);
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
    const records = [...owned, ...received].filter((item) => item.relationshipId && authorizedRelationshipIds.has(item.relationshipId))
      .filter((item) => since ? item.createdAt > since : true);
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
      moments: await Promise.all(page.items.map((item) => viewerFocusMoment(this.database, item, userId))),
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

  private async currentRelationshipRecord(userId: string) {
    return (await relationshipsForFocusUser(this.database, userId, ["accepted"]))[0];
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    const row = await findBuddyRelationship(this.database, relationshipId);
    const relationship = row?.kind === "focus_relationship" ? { ...row, status: row.status === "active" ? "accepted" : row.status } : undefined;
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

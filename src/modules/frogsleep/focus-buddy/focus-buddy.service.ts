import { FocusBuddyQueries } from "./focus-buddy-queries.ts";
import { storeFocusSession } from "./focus-session-writer.ts";
import { buddyRelationships, revokeFocusDomainRelationship } from "../buddy-growth/buddy-relationships.ts";
import { BuddyJointActivityService } from "../buddy-growth/buddy-joint-activity.service.ts";
import { BuddyJointGoalService } from "../buddy-growth/buddy-joint-goal.service.ts";
import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { ContentSafetyService } from "../../../services/content-safety.service.ts";
import type { ContentSafetyCheckCommand } from "../../../services/content-safety-types.ts";
import { badRequest, forbidden, tooManyRequests } from "../../../shared/errors.ts";
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
  focusInviteAction,
  pendingFocusInvites,
  previewFocusInvite,
  recordFocusMatchFeedback,
  trackFocusInviteOpenByToken,
} from "./focus-buddy-invites.ts";
import { buildFocusMatchProfilePayload } from "./focus-match-ranking.ts";
import { validateFocusMessagePayload } from "./focus-buddy-message-validation.ts";
import {
  nextFocusRelationshipStatus,
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

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
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
    const stored = await storeFocusSession(this.database, userId, input);
    await new BuddyJointActivityService(this.database).refresh(userId);
    await new BuddyJointGoalService(this.database).list(userId);
    await unlockFocusMilestone(this.database, userId, "first_session");
    await this.detectSharedMoment(stored);
    return toFocusSessionResponse(stored);
  }

  async sessions(userId: string, from?: string, to?: string, pagination?: PaginationParams) {
    return await new FocusBuddyQueries(this.database).sessions(userId, from, to, pagination);
  }

  async weekStats(userId: string, weekStart?: string) {
    return await new FocusBuddyQueries(this.database).weekStats(userId, weekStart);
  }

  async achievements(userId: string, pagination?: PaginationParams) {
    return await new FocusBuddyQueries(this.database).achievements(userId, pagination);
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
    if (action === "revoke") {
      const canonical = await revokeFocusDomainRelationship(this.database, userId, relationshipId);
      if (canonical) return toFocusRelationshipResponse(canonical, userId);
    }
    const relationship = await this.requireRelationship(userId, relationshipId);
    if (action !== "accept" && action !== "decline" && action !== "revoke") {
      badRequest("REQ_INVALID_BODY", "Unsupported focus relationship action.");
    }
    const status = nextFocusRelationshipStatus(relationship.status, action);
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
    return await new FocusBuddyQueries(this.database).presence(userId, buddyUserId);
  }

  async comparison(userId: string, weekStart?: string) {
    return await new FocusBuddyQueries(this.database).comparison(userId, weekStart);
  }

  async sharedMoments(userId: string, pagination?: PaginationParams, filters: { roomId?: string; from?: string; to?: string } = {}) {
    return await new FocusBuddyQueries(this.database).sharedMoments(userId, pagination, filters);
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
    return await new FocusBuddyQueries(this.database).detectSharedMoment(session);
  }

  private async currentRelationshipRecord(userId: string) {
    return (await relationshipsForFocusUser(this.database, userId, ["accepted"]))[0];
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    const relationship = (await buddyRelationships(this.database, userId, "focus")).find(item => item.id === relationshipId);
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
    return await new FocusBuddyQueries(this.database).assertMessageRateLimit(userId, receiverUserId);
  }

  private deps() {
    return {
      database: this.database,
      notificationService: this.notificationService,
    };
  }



}

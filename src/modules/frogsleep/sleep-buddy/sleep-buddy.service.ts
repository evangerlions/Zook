import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import {
  toSleepInviteResponse,
  toSleepRelationshipResponse,
  toSleepSessionResponse,
} from "./sleep-buddy-mappers.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultInviteExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + INVITE_TTL_MS).toISOString();
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function asPayload(record?: FrogSleepEntityRecord): Record<string, unknown> {
  return record?.payload ?? {};
}

function normalizeEmail(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized?.includes("@") ? normalized : undefined;
}

export class FrogSleepSleepBuddyService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly notificationService?: NotificationService,
  ) {}

  async createInvite(command: {
    userId: string;
    invitee: string;
    role?: string;
    customLabel?: string;
    sleepInviteBaseUrl?: string;
  }) {
    const invitee = command.invitee.trim();
    if (!invitee) {
      badRequest("REQ_INVALID_BODY", "invitee is required.");
    }

    const inviteeEmailSnapshot = normalizeEmail(invitee);
    const target = await this.resolveUser(invitee);
    if (target?.id === command.userId) {
      badRequest("REQ_INVALID_BODY", "Cannot invite yourself.");
    }
    if (target) {
      await this.assertNoConflict(command.userId, target.id);
    }

    const createdAt = nowIso();
    const code = randomCode();
    const token = randomId("sleep_invite_token");
    const link = `${command.sleepInviteBaseUrl ?? "frogsleep://sleep-buddy-invite"}?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`;
    const expiresAt = defaultInviteExpiresAt(createdAt);
    const invite: FrogSleepEntityRecord = {
      id: randomId("sleep_invite"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_invite",
      ownerUserId: command.userId,
      partnerUserId: target?.id,
      status: "pending",
      code,
      token,
      payload: {
        invitee,
        inviteeEmailSnapshot: inviteeEmailSnapshot ?? normalizeEmail(target?.email),
        role: command.role ?? "guardian",
        customLabel: command.customLabel,
        shareLink: link,
        shareTitle: "睡眠搭子邀请",
        shareSubtitle: "一起守住今晚的睡眠节奏",
        expires_at: expiresAt,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(invite);
    if (target?.id) {
      await this.queuePush(target.id, buildFrogSleepNotificationPayload({
        type: "sleep_buddy_invite",
        entityId: invite.id,
      }));
    }
    return toSleepInviteResponse(invite);
  }

  async pendingInvites(userId: string) {
    const owned = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_invite",
      ownerUserId: userId,
      status: "pending",
    });
    const received = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_invite",
      partnerUserId: userId,
      status: "pending",
    });
    const invites = await Promise.all([...owned, ...received].map((invite) => this.refreshInviteStatus(invite)));
    return invites
      .filter((invite) => invite.status === "pending")
      .map((invite) => toSleepInviteResponse(invite));
  }

  async acceptInviteByCode(userId: string, code: string) {
    const invite = await this.database.findFrogSleepEntityByCode("sleep_invite", FROGSLEEP_APP_ID, code.trim());
    return await this.acceptInvite(userId, invite);
  }

  async acceptInviteByToken(userId: string, token: string) {
    const invite = await this.database.findFrogSleepEntityByToken("sleep_invite", FROGSLEEP_APP_ID, token.trim());
    return await this.acceptInvite(userId, invite);
  }

  async acceptInviteById(userId: string, inviteId: string) {
    const invite = await this.database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, inviteId);
    return await this.acceptInvite(userId, invite);
  }

  async inviteAction(userId: string, inviteId: string, action: "decline" | "cancel") {
    const invite = await this.database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, inviteId);
    if (!invite || invite.status !== "pending") {
      badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    }
    if (action === "cancel" && invite.ownerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the inviter can cancel this invite.");
    }
    if (action === "decline" && invite.partnerUserId && invite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can decline this invite.");
    }
    const updated = await this.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, inviteId, {
      status: action === "cancel" ? "cancelled" : "declined",
    });
    return toSleepInviteResponse(updated as FrogSleepEntityRecord);
  }

  async currentRelationship(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active", "paused"]);
    return relationships[0] ? toSleepRelationshipResponse(relationships[0], userId) : null;
  }

  async relationshipDetail(userId: string, relationshipId: string) {
    const relationship = await this.requireRelationship(userId, relationshipId);
    return toSleepRelationshipResponse(relationship, userId);
  }

  async relationshipAction(userId: string, relationshipId: string, action: "pause" | "resume" | "revoke") {
    const relationship = await this.requireRelationship(userId, relationshipId);
    const status = action === "pause" ? "paused" : action === "resume" ? "active" : "revoked";
    const updated = await this.database.updateFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, relationship.id, {
      status,
    });
    return toSleepRelationshipResponse(updated as FrogSleepEntityRecord, userId);
  }

  async updatePreferences(userId: string, relationshipId: string, preferences: Record<string, unknown>) {
    await this.requireRelationship(userId, relationshipId);
    const existing = (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference",
      ownerUserId: userId,
      relationshipId,
      limit: 1,
    }))[0];
    if (existing) {
      const updated = await this.database.updateFrogSleepEntity("guardianship_preference", FROGSLEEP_APP_ID, existing.id, {
        payload: {
          ...existing.payload,
          ...preferences,
        },
      });
      return updated?.payload ?? preferences;
    }

    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("sleep_pref"),
      appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference",
      ownerUserId: userId,
      relationshipId,
      payload: this.defaultPreferences(preferences),
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(record);
    return record.payload;
  }

  async statusSnapshot(userId: string) {
    const relationship = await this.currentRelationship(userId);
    const activeSession = relationship
      ? await this.activeSession(userId)
      : null;
    return {
      pending_invites: await this.pendingInvites(userId),
      current_relationship: relationship,
      active_session: activeSession,
      latest_summary: await this.latestSummary(userId),
      latest_recap: await this.latestRecap(userId),
    };
  }

  async beginSession(userId: string, relationshipId: string, dateAnchor?: string) {
    const relationship = await this.requireRelationship(userId, relationshipId);
    if (relationship.status !== "active") {
      conflict("REQ_INVALID_BODY", "Shared sleep session requires an active relationship.");
    }
    const createdAt = nowIso();
    const partnerUserId = this.otherUserId(relationship, userId);
    const session: FrogSleepEntityRecord = {
      id: randomId("sleep_session"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_session",
      ownerUserId: userId,
      partnerUserId,
      relationshipId,
      status: "pending",
      startsAt: createdAt,
      payload: {
        dateAnchor,
        participantStates: {
          [userId]: "started",
          [partnerUserId]: "pending",
        },
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(session);
    await this.queuePush(partnerUserId, buildFrogSleepNotificationPayload({
      type: "shared_session_invite",
      entityId: session.id,
      relationshipId,
      sessionId: session.id,
    }));
    return toSleepSessionResponse(session, userId);
  }

  async activeSession(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active", "paused"]);
    for (const relationship of relationships) {
      const sessions = await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "sleep_session",
        relationshipId: relationship.id,
        status: "active",
        limit: 1,
      });
      if (sessions[0]) {
        return toSleepSessionResponse(sessions[0], userId);
      }
      const pending = await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "sleep_session",
        relationshipId: relationship.id,
        status: "pending",
        limit: 1,
      });
      if (pending[0]) {
        return toSleepSessionResponse(pending[0], userId);
      }
    }
    return null;
  }

  async acceptSession(userId: string, sessionId: string) {
    const session = await this.requireSession(userId, sessionId);
    const participantStates = {
      ...((session.payload.participantStates as Record<string, string> | undefined) ?? {}),
      [userId]: "accepted",
    };
    const updated = await this.database.updateFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, session.id, {
      status: "active",
      payload: {
        ...session.payload,
        participantStates,
      },
    });
    return toSleepSessionResponse(updated as FrogSleepEntityRecord, userId);
  }

  async recordEvent(userId: string, sessionId: string, eventType: string, metadata: Record<string, unknown> = {}, occurredAt = nowIso()) {
    const session = await this.requireSession(userId, sessionId);
    const createdAt = nowIso();
    await this.database.insertFrogSleepEntity({
      id: randomId("sleep_event"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_event",
      ownerUserId: userId,
      partnerUserId: this.otherUserId(session, userId),
      relationshipId: session.relationshipId,
      sessionId,
      status: eventType,
      occurredAt,
      payload: metadata,
      createdAt,
      updatedAt: createdAt,
    });

    const nextStatus = eventType === "paused_tonight" || eventType === "morning_completed" ? "completed" : "active";
    const participantStates = {
      ...((session.payload.participantStates as Record<string, string> | undefined) ?? {}),
      [userId]: eventType,
    };
    const updated = await this.database.updateFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, session.id, {
      status: nextStatus,
      occurredAt,
      payload: {
        ...session.payload,
        participantStates,
        lastEventType: eventType,
      },
    });

    if (eventType === "morning_completed") {
      await this.generateMorningArtifacts(updated as FrogSleepEntityRecord);
      await this.queuePush(this.otherUserId(session, userId), buildFrogSleepNotificationPayload({
        type: "morning_summary",
        entityId: session.id,
        relationshipId: session.relationshipId,
        sessionId: session.id,
      }));
    }
    if (eventType === "interrupted" || eventType === "returned") {
      await this.queuePush(this.otherUserId(session, userId), buildFrogSleepNotificationPayload({
        type: eventType === "interrupted" ? "shared_session_interrupted" : "shared_session_returned",
        entityId: session.id,
        relationshipId: session.relationshipId,
        sessionId: session.id,
      }));
    }

    return toSleepSessionResponse(updated as FrogSleepEntityRecord, userId);
  }

  async pauseTonight(userId: string, sessionId: string) {
    return await this.recordEvent(userId, sessionId, "paused_tonight");
  }

  async latestSummary(userId: string) {
    const summaries = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_summary",
      ownerUserId: userId,
      limit: 1,
    });
    return summaries[0]?.payload ?? null;
  }

  async latestRecap(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active", "paused", "revoked"]);
    for (const relationship of relationships) {
      const recaps = await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "night_recap",
        relationshipId: relationship.id,
        limit: 1,
      });
      if (recaps[0]) {
        return recaps[0].payload;
      }
    }
    return null;
  }

  private async acceptInvite(userId: string, invite?: FrogSleepEntityRecord) {
    const currentInvite = invite ? await this.refreshInviteStatus(invite) : undefined;
    if (currentInvite?.status === "expired") {
      badRequest("REQ_INVALID_BODY", "Invite has expired.");
    }
    if (!currentInvite || currentInvite.status !== "pending") {
      badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    }
    if (currentInvite.ownerUserId === userId) {
      badRequest("REQ_INVALID_BODY", "Cannot accept your own invite.");
    }
    if (currentInvite.partnerUserId && currentInvite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "This invite is not for the current user.");
    }
    await this.assertInviteEmailOwner(currentInvite, userId);

    await this.assertNoConflict(currentInvite.ownerUserId as string, userId);
    const createdAt = nowIso();
    const relationship: FrogSleepEntityRecord = {
      id: randomId("sleep_relationship"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_relationship",
      ownerUserId: currentInvite.ownerUserId,
      partnerUserId: userId,
      status: "active",
      payload: {
        inviteId: currentInvite.id,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await this.database.insertFrogSleepEntity(relationship);
    await this.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, currentInvite.id, {
      status: "accepted",
      partnerUserId: userId,
      relationshipId: relationship.id,
    });
    await this.createDefaultPreference(relationship.id, relationship.ownerUserId as string);
    await this.createDefaultPreference(relationship.id, userId);
    return toSleepRelationshipResponse(relationship, userId);
  }

  private async refreshInviteStatus(invite: FrogSleepEntityRecord) {
    if (invite.status !== "pending" || !this.isInviteExpired(invite)) {
      return invite;
    }
    return await this.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, invite.id, {
      status: "expired",
    }) as FrogSleepEntityRecord;
  }

  private isInviteExpired(invite: FrogSleepEntityRecord): boolean {
    const expiresAt = asPayload(invite).expires_at ?? asPayload(invite).expiresAt;
    return typeof expiresAt === "string" && new Date(expiresAt).getTime() <= Date.now();
  }

  private async assertNoConflict(userA: string, userB: string) {
    const relationships = await this.relationshipsForUser(userA, ["active", "paused"]);
    if (relationships.some((item) => this.otherUserId(item, userA) === userB)) {
      conflict("REQ_INVALID_BODY", "A sleep buddy relationship already exists.");
    }
  }

  private async resolveUser(value: string) {
    if (value.includes("@")) {
      return await this.database.findUserByAccount(value);
    }
    return await this.database.findUserById(value);
  }

  private async assertInviteEmailOwner(invite: FrogSleepEntityRecord, userId: string) {
    const payload = asPayload(invite);
    const inviteeEmailSnapshot = normalizeEmail(
      typeof payload.inviteeEmailSnapshot === "string"
        ? payload.inviteeEmailSnapshot
        : typeof payload.invitee_email_snapshot === "string"
          ? payload.invitee_email_snapshot
          : undefined,
    );
    if (!inviteeEmailSnapshot) {
      return;
    }
    const user = await this.database.findUserById(userId);
    if (normalizeEmail(user?.email) !== inviteeEmailSnapshot) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "This invite is not for the current verified email.");
    }
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

  private async relationshipsForUser(userId: string, statuses: string[]) {
    const owned = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_relationship",
      ownerUserId: userId,
      limit: 100,
    });
    const partnered = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_relationship",
      partnerUserId: userId,
      limit: 100,
    });
    return [...owned, ...partnered].filter((item) => item.status && statuses.includes(item.status));
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    const relationship = await this.database.findFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, relationshipId);
    if (!relationship || (relationship.ownerUserId !== userId && relationship.partnerUserId !== userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Relationship is not visible to the current user.");
    }
    return relationship;
  }

  private async requireSession(userId: string, sessionId: string) {
    const session = await this.database.findFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, sessionId);
    if (!session || (session.ownerUserId !== userId && session.partnerUserId !== userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Session is not visible to the current user.");
    }
    return session;
  }

  private otherUserId(record: FrogSleepEntityRecord, userId: string): string {
    return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
  }

  private defaultPreferences(overrides: Record<string, unknown> = {}) {
    return {
      guard_level: "standard",
      visibility_scope: "summary",
      mute_for_tonight: false,
      allow_morning_summary_push: true,
      allow_recovery_nudges: true,
      ...overrides,
    };
  }

  private async createDefaultPreference(relationshipId: string, userId: string) {
    const createdAt = nowIso();
    await this.database.insertFrogSleepEntity({
      id: randomId("sleep_pref"),
      appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference",
      ownerUserId: userId,
      relationshipId,
      payload: this.defaultPreferences(),
      createdAt,
      updatedAt: createdAt,
    });
  }

  private async generateMorningArtifacts(session: FrogSleepEntityRecord) {
    const createdAt = nowIso();
    const users = [session.ownerUserId, session.partnerUserId].filter(Boolean) as string[];
    for (const userId of users) {
      await this.database.insertFrogSleepEntity({
        id: randomId("sleep_summary"),
        appId: FROGSLEEP_APP_ID,
        kind: "sleep_summary",
        ownerUserId: userId,
        partnerUserId: users.find((item) => item !== userId),
        relationshipId: session.relationshipId,
        sessionId: session.id,
        status: "generated",
        payload: {
          session_id: session.id,
          title: "昨晚结果已更新",
          completed: true,
        },
        createdAt,
        updatedAt: createdAt,
      });
    }
    await this.database.insertFrogSleepEntity({
      id: randomId("night_recap"),
      appId: FROGSLEEP_APP_ID,
      kind: "night_recap",
      ownerUserId: session.ownerUserId,
      partnerUserId: session.partnerUserId,
      relationshipId: session.relationshipId,
      sessionId: session.id,
      status: "generated",
      payload: {
        session_id: session.id,
        title: "共同守护完成",
        participant_states: session.payload.participantStates,
      },
      createdAt,
      updatedAt: createdAt,
    });
  }

}

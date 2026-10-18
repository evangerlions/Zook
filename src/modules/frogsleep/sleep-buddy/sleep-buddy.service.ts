import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { isBuddyAuthorizationDenied, latestAuthorizedSleepArtifact } from "../buddy-growth/buddy-artifact-redaction.ts";
import {
  acceptSleepInviteByCode,
  acceptSleepInviteById,
  acceptSleepInviteByToken,
  createSleepInvite,
  pendingSleepInvites,
  previewSleepInvite,
  sleepInviteAction,
  trackSleepInviteOpenByToken,
} from "./sleep-buddy-invites.ts";
import {
  toSleepRelationshipResponse,
  toSleepSessionResponse,
} from "./sleep-buddy-mappers.ts";

import { SleepSessionEventService } from "./sleep-session-event.service.ts";
import { queueSleepPush } from "./sleep-notification-policy.ts";
import { SleepPreferenceService } from "./sleep-preference.service.ts";
import { SleepRelationshipService } from "./sleep-relationship.service.ts";

function nowIso(): string {
  return new Date().toISOString();
}

/** Coordinates sleep invitations, relationships and shared-session runtime operations. */
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
    bundleId?: string;
  }) {
    return await createSleepInvite(this.deps(), command);
  }

  async pendingInvites(userId: string) {
    return await pendingSleepInvites(this.deps(), userId);
  }

  async acceptInviteByCode(userId: string, code: string) {
    return await acceptSleepInviteByCode(this.deps(), userId, code);
  }

  async acceptInviteByToken(userId: string, token: string) {
    return await acceptSleepInviteByToken(this.deps(), userId, token);
  }

  async acceptInviteById(userId: string, inviteId: string) {
    return await acceptSleepInviteById(this.deps(), userId, inviteId);
  }

  async inviteAction(userId: string, inviteId: string, action: "decline" | "cancel") {
    return await sleepInviteAction(this.deps(), userId, inviteId, action);
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
    const relationship = await new SleepRelationshipService(this.database).act(userId, relationshipId, action);
    return toSleepRelationshipResponse(relationship, userId);
  }

  async updatePreferences(userId: string, relationshipId: string, preferences: Record<string, unknown>) {
    await this.requireRelationship(userId, relationshipId);
    return await new SleepPreferenceService(this.database).update(userId, relationshipId, preferences);
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
    return await new SleepRelationshipService(this.database).withSession(userId, relationshipId, async () => {
      const relationship = await this.requireRelationship(userId, relationshipId);
      if (relationship.status !== "active") conflict("REQ_INVALID_BODY", "Shared sleep session requires an active relationship.");
      await assertBuddyDataAuthorized(this.database, userId, relationshipId, "shared_activity");
      const normalizedDateAnchor = dateAnchor || nowIso().slice(0, 10);
      const existing = await this.findOpenSessionForDate(relationshipId, normalizedDateAnchor);
      if (existing) return toSleepSessionResponse(existing, userId);
      const partnerUserId = this.otherUserId(relationship, userId);
      const session = newSleepSession(userId, partnerUserId, relationshipId, normalizedDateAnchor);
      await this.database.insertFrogSleepEntity(session);
      await this.queuePush(partnerUserId, buildFrogSleepNotificationPayload({
        type: "shared_session_invite", entityId: session.id, relationshipId, sessionId: session.id }));
      return toSleepSessionResponse(session, userId);
    });
  }

  async activeSession(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active"]);
    for (const relationship of relationships) {
      try { await assertBuddyDataAuthorized(this.database, userId, relationship.id, "shared_activity"); }
      catch (error) { if (isBuddyAuthorizationDenied(error)) continue; throw error; }
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
    if (!session.relationshipId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Session relationship is unavailable.");
    return await new SleepRelationshipService(this.database).withSession(userId, session.relationshipId, async () => {
      const current = await this.requireSession(userId, sessionId);
      await assertBuddyDataAuthorized(this.database, userId, session.relationshipId!, "shared_activity");
      const participantStates = { ...((current.payload.participantStates as Record<string, string> | undefined) ?? {}), [userId]: "accepted" };
      const updated = await this.database.updateFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, session.id, {
        status: "active", payload: { ...current.payload, participantStates } });
      return toSleepSessionResponse(updated as FrogSleepEntityRecord, userId);
    });
  }

  async recordEvent(userId: string, sessionId: string, eventType: string, metadata: Record<string, unknown> = {}, occurredAt = nowIso()) {
    return await new SleepSessionEventService(this.database, this.notificationService)
      .record(userId, sessionId, eventType, metadata, occurredAt);
  }

  async pauseTonight(userId: string, sessionId: string) {
    return await this.recordEvent(userId, sessionId, "paused_tonight");
  }

  async latestSummary(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active"]);
    return await latestAuthorizedSleepArtifact(this.database, userId, relationships, "sleep_summary");
  }

  async latestRecap(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active"]);
    return await latestAuthorizedSleepArtifact(this.database, userId, relationships, "night_recap");
  }

  async trackInviteOpenByToken(token: string, userAgent?: string) {
    await trackSleepInviteOpenByToken(this.deps(), token, userAgent);
  }

  async previewInvite(userId: string, input: { token?: string; code?: string }) {
    return await previewSleepInvite(this.deps(), userId, input);
  }

  private async queuePush(userId: string, payload: Record<string, unknown>) {
    await queueSleepPush(this.database, this.notificationService, userId, payload);
  }

  private async relationshipsForUser(userId: string, statuses: string[]) {
    return await new SleepRelationshipService(this.database).list(userId, statuses);
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    return await new SleepRelationshipService(this.database).require(userId, relationshipId);
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

  private async findOpenSessionForDate(relationshipId: string, dateAnchor: string) {
    const sessions: FrogSleepEntityRecord[] = [];
    for (const status of ["active", "pending"]) {
      sessions.push(...await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "sleep_session",
        relationshipId,
        status,
        limit: 100,
      }));
    }
    return sessions.find((session) => this.sessionDateAnchor(session) === dateAnchor);
  }

  private sessionDateAnchor(session: FrogSleepEntityRecord): string {
    return typeof session.payload.dateAnchor === "string"
      ? session.payload.dateAnchor
      : typeof session.payload.date_anchor === "string"
        ? session.payload.date_anchor
        : (session.startsAt ?? session.createdAt).slice(0, 10);
  }

  private deps() {
    return {
      database: this.database,
      notificationService: this.notificationService,
    };
  }

}

function newSleepSession(userId: string, partnerUserId: string, relationshipId: string, dateAnchor: string): FrogSleepEntityRecord {
  const now = nowIso();
  return { id: randomId("sleep_session"), appId: FROGSLEEP_APP_ID, kind: "sleep_session",
    ownerUserId: userId, partnerUserId, relationshipId, status: "pending", startsAt: now,
    payload: { dateAnchor, date_anchor: dateAnchor, participantStates: { [userId]: "started", [partnerUserId]: "pending" } },
    createdAt: now, updatedAt: now };
}

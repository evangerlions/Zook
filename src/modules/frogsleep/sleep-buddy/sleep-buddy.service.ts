import { BuddyJointActivityService } from "../buddy-growth/buddy-joint-activity.service.ts";
import { BuddyJointGoalService } from "../buddy-growth/buddy-joint-goal.service.ts";
import { createHash } from "node:crypto";
import { generateSharedMorningArtifacts } from "./sleep-shared-morning.ts";
import { sleepPushSuppression } from "./sleep-notification-policy.ts";
import { isBuddyAuthorizationDenied } from "../buddy-growth/buddy-artifact-redaction.ts";
import { buddyRelationshipMute } from "../buddy-growth/buddy-relationship-lifecycle.service.ts";
import { buddyRelationshipSlotKeys, currentBuddyRelationships, findBuddyRelationship } from "../buddy-growth/buddy-relationship-facts.ts";
import { BuddyRelationshipLifecycleService } from "../buddy-growth/buddy-relationship-lifecycle.service.ts";
import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { latestAuthorizedSleepArtifact } from "../buddy-growth/buddy-artifact-redaction.ts";
import { optionalIsoTimestamp } from "../frogsleep-validation.ts";
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
  buildSleepRecapArtifact,
  buildSleepSummaryArtifact,
} from "./sleep-buddy-artifacts.ts";
import {
  toSleepRelationshipResponse,
  toSleepSessionResponse,
} from "./sleep-buddy-mappers.ts";

function nowIso(): string {
  return new Date().toISOString();
}

const SLEEP_EVENT_TYPES = new Set(["sleep_started", "ritual_completed", "interrupted", "returned", "paused_tonight", "morning_completed"]);
const GUARD_LEVELS = new Set(["relaxed", "standard", "strict"]);
const VISIBILITY_SCOPES = new Set(["summary", "detailed", "private"]);
const PREFERENCE_KEYS = new Set([
  "guard_level",
  "visibility_scope",
  "mute_for_tonight",
  "allow_morning_summary_push",
  "allow_recovery_nudges",
]);

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
    const relationship = await this.requireRelationship(userId, relationshipId);
    await new BuddyRelationshipLifecycleService(this.database).execute(userId, relationshipId, action);
    const updated = await findBuddyRelationship(this.database, relationshipId);
    return toSleepRelationshipResponse(updated as FrogSleepEntityRecord, userId);
  }

  async updatePreferences(userId: string, relationshipId: string, preferences: Record<string, unknown>) {
    await this.requireRelationship(userId, relationshipId);
    const validated = this.validatePreferences(preferences);
    const existing = (await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference",
      ownerUserId: userId,
      relationshipId,
      limit: 100,
    })).find(row => row.status !== "buddy_relationship_notifications");
    if (existing) {
      const updated = await this.database.updateFrogSleepEntity("guardianship_preference", FROGSLEEP_APP_ID, existing.id, {
        payload: {
          ...existing.payload,
          ...validated,
        },
      });
      return updated?.payload ?? validated;
    }

    const createdAt = nowIso();
    const record: FrogSleepEntityRecord = {
      id: randomId("sleep_pref"),
      appId: FROGSLEEP_APP_ID,
      kind: "guardianship_preference",
      ownerUserId: userId,
      relationshipId,
      payload: this.defaultPreferences(validated),
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
    const initial = await this.requireRelationship(userId, relationshipId);
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(initial), async () => {
      const relationship = await this.requireRelationship(userId, relationshipId);
      if (relationship.status !== "active") {
        conflict("REQ_INVALID_BODY", "Shared sleep session requires an active relationship.");
      }
      await assertBuddyDataAuthorized(this.database, userId, relationshipId, "shared_activity");
      const createdAt = nowIso();
      const normalizedDateAnchor = dateAnchor || createdAt.slice(0, 10);
      const existing = await this.findOpenSessionForDate(relationshipId, normalizedDateAnchor);
      if (existing) {
        return toSleepSessionResponse(existing, userId);
      }
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
          dateAnchor: normalizedDateAnchor,
          date_anchor: normalizedDateAnchor,
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
    return await this.withSharedSessionLock(userId, sessionId, () => this.acceptSessionLocked(userId, sessionId));
  }

  private async acceptSessionLocked(userId: string, sessionId: string) {
    const session = await this.requireSession(userId, sessionId);
    if (!session.relationshipId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Session relationship is unavailable.");
    await assertBuddyDataAuthorized(this.database, userId, session.relationshipId, "shared_activity");
    const ownState = (session.payload.participantStates as Record<string, string> | undefined)?.[userId];
    if (session.status === "completed" || ownState === "accepted" || SLEEP_EVENT_TYPES.has(ownState ?? "")) {
      return toSleepSessionResponse(session, userId);
    }
    if (!["pending", "active"].includes(session.status ?? "")) conflict("REQ_INVALID_BODY", "Shared session is terminal.");
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
    return await this.withSharedSessionLock(userId, sessionId,
      () => this.recordEventLocked(userId, sessionId, eventType, metadata, occurredAt));
  }

  private async recordEventLocked(userId: string, sessionId: string, eventType: string, metadata: Record<string, unknown>, occurredAt: string) {
    if (!SLEEP_EVENT_TYPES.has(eventType)) {
      badRequest("REQ_INVALID_BODY", "Unsupported sleep event type.");
    }
    const normalizedOccurredAt = optionalIsoTimestamp(occurredAt, "occurred_at") ?? nowIso();
    const session = await this.requireSession(userId, sessionId);
    const relationship = session.relationshipId
      ? await this.requireRelationship(userId, session.relationshipId)
      : undefined;
    if (!relationship || relationship.status !== "active") {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Session relationship is not visible to the current user.");
    }
    await assertBuddyDataAuthorized(this.database, userId, relationship.id, "shared_activity");
    const currentStates = (session.payload.participantStates as Record<string, string> | undefined) ?? {};
    if (currentStates[userId] === eventType && ["morning_completed", "paused_tonight"].includes(eventType)) return toSleepSessionResponse(session, userId);
    if (session.status === "completed" || ["morning_completed", "paused_tonight"].includes(currentStates[userId])) conflict("REQ_INVALID_BODY", "Shared participant is terminal.");
    const createdAt = nowIso();
    const eventId = `sleep_event_${createHash("sha256").update(JSON.stringify([sessionId, userId, eventType, normalizedOccurredAt])).digest("hex")}`;
    if (await this.database.findFrogSleepEntity("sleep_event", FROGSLEEP_APP_ID, eventId)) return toSleepSessionResponse(session, userId);
    await this.database.insertFrogSleepEntity({
      id: eventId,
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_event",
      ownerUserId: userId,
      partnerUserId: this.otherUserId(session, userId),
      relationshipId: session.relationshipId,
      sessionId,
      status: eventType,
      occurredAt: normalizedOccurredAt,
      payload: metadata,
      createdAt,
      updatedAt: createdAt,
    });

    const participantStates = {
      ...((session.payload.participantStates as Record<string, string> | undefined) ?? {}),
      [userId]: eventType,
    };
    const bothTerminal = [session.ownerUserId, session.partnerUserId]
      .every(user => user && ["morning_completed", "paused_tonight"].includes(participantStates[user]));
    const nextStatus = bothTerminal ? "completed" : "active";
    const updated = await this.database.updateFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, session.id, {
      status: nextStatus,
      endsAt: nextStatus === "completed" ? normalizedOccurredAt : undefined,
      occurredAt: normalizedOccurredAt,
      payload: {
        ...session.payload,
        participantStates,
        lastEventType: eventType,
      },
    });

    if (eventType === "morning_completed" || eventType === "paused_tonight") {
      await generateSharedMorningArtifacts(this.database, updated as FrogSleepEntityRecord);
    }
    if (eventType === "morning_completed") {
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

    await new BuddyJointActivityService(this.database).refresh(userId);
    await new BuddyJointGoalService(this.database).list(userId);
    return toSleepSessionResponse(updated as FrogSleepEntityRecord, userId);
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
    if (!this.notificationService) {
      return;
    }
    if (await sleepPushSuppression(this.database, userId, payload)) return;
    const relationshipId = typeof payload.relationshipId === "string" ? payload.relationshipId : undefined;
    if (relationshipId) {
      if ((await buddyRelationshipMute(this.database, userId, relationshipId))?.payload.muted === true) return;
      try { await assertBuddyDataAuthorized(this.database, userId, relationshipId,
        payload.type === "morning_summary" ? "daily_summary" : "shared_activity"); }
      catch (error) { if (isBuddyAuthorizationDenied(error)) return; throw error; }
    }
    await this.notificationService.queueNotification({
      appId: FROGSLEEP_APP_ID,
      recipientUserId: userId,
      channel: "push",
      payload,
    });
  }

  private async relationshipsForUser(userId: string, statuses: string[]) {
    return (await currentBuddyRelationships(this.database, userId)).filter((row) =>
      row.kind === "sleep_relationship" && statuses.includes(row.status ?? ""));
  }

  private async requireRelationship(userId: string, relationshipId: string) {
    const relationship = await findBuddyRelationship(this.database, relationshipId);
    if (!relationship || relationship.kind !== "sleep_relationship" || (relationship.ownerUserId !== userId && relationship.partnerUserId !== userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Relationship is not visible to the current user.");
    }
    return relationship;
  }

  private async withSharedSessionLock<T>(userId: string, id: string, operation: () => Promise<T>): Promise<T> {
    const initial = await this.requireSession(userId, id);
    if (!initial.relationshipId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Shared session is unavailable.");
    const relationship = await this.requireRelationship(userId, initial.relationshipId);
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(relationship), async () => {
      const current = await this.requireSession(userId, id);
      if (current.status === "cancelled") conflict("REQ_INVALID_BODY", "Shared session was terminated.");
      return await operation();
    });
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

  private validatePreferences(input: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!PREFERENCE_KEYS.has(key)) {
        badRequest("REQ_INVALID_BODY", `Unsupported preference field: ${key}.`);
      }
      if (key === "guard_level") {
        if (typeof value !== "string" || !GUARD_LEVELS.has(value)) {
          badRequest("REQ_INVALID_BODY", "guard_level is invalid.");
        }
        next[key] = value;
        continue;
      }
      if (key === "visibility_scope") {
        if (typeof value !== "string" || !VISIBILITY_SCOPES.has(value)) {
          badRequest("REQ_INVALID_BODY", "visibility_scope is invalid.");
        }
        next[key] = value;
        continue;
      }
      if (typeof value !== "boolean") {
        badRequest("REQ_INVALID_BODY", `${key} must be a boolean.`);
      }
      next[key] = value;
    }
    return next;
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

  private deps() {
    return {
      database: this.database,
      notificationService: this.notificationService,
    };
  }

}

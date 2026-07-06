import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
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

const SLEEP_EVENT_TYPES = new Set(["interrupted", "returned", "paused_tonight", "morning_completed"]);
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
    const status = this.nextRelationshipStatus(relationship.status, action);
    const updated = await this.database.updateFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, relationship.id, {
      status,
    });
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
      limit: 1,
    }))[0];
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
    return await this.database.withExclusiveSession(async () => {
      const relationship = await this.requireRelationship(userId, relationshipId);
      if (relationship.status !== "active") {
        conflict("REQ_INVALID_BODY", "Shared sleep session requires an active relationship.");
      }
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
    if (!SLEEP_EVENT_TYPES.has(eventType)) {
      badRequest("REQ_INVALID_BODY", "Unsupported sleep event type.");
    }
    const normalizedOccurredAt = optionalIsoTimestamp(occurredAt, "occurred_at") ?? nowIso();
    const session = await this.requireSession(userId, sessionId);
    const relationship = session.relationshipId
      ? await this.requireRelationship(userId, session.relationshipId)
      : undefined;
    if (!relationship || relationship.status === "revoked") {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Session relationship is not visible to the current user.");
    }
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
      occurredAt: normalizedOccurredAt,
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
      occurredAt: normalizedOccurredAt,
      payload: {
        ...session.payload,
        participantStates,
        lastEventType: eventType,
      },
    });

    if (eventType === "morning_completed" || eventType === "paused_tonight") {
      await this.generateMorningArtifacts(updated as FrogSleepEntityRecord);
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

    return toSleepSessionResponse(updated as FrogSleepEntityRecord, userId);
  }

  async pauseTonight(userId: string, sessionId: string) {
    return await this.recordEvent(userId, sessionId, "paused_tonight");
  }

  async latestSummary(userId: string) {
    const relationships = await this.relationshipsForUser(userId, ["active", "paused", "revoked"]);
    for (const relationship of relationships) {
      const summaries = await this.database.listFrogSleepEntities({
        appId: FROGSLEEP_APP_ID,
        kind: "sleep_summary",
        ownerUserId: userId,
        relationshipId: relationship.id,
        limit: 1,
      });
      if (summaries[0]) {
        return summaries[0].payload;
      }
    }
    return null;
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

  private nextRelationshipStatus(currentStatus: string | undefined, action: "pause" | "resume" | "revoke"): string {
    if (currentStatus === "revoked") {
      conflict("REQ_INVALID_BODY", "Revoked relationship cannot be changed.");
    }
    if (action === "pause" && currentStatus === "active") {
      return "paused";
    }
    if (action === "resume" && currentStatus === "paused") {
      return "active";
    }
    if (action === "revoke" && (currentStatus === "active" || currentStatus === "paused")) {
      return "revoked";
    }
    conflict("REQ_INVALID_BODY", "Relationship action is not valid for the current status.");
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

  private async generateMorningArtifacts(session: FrogSleepEntityRecord) {
    const createdAt = nowIso();
    const users = [session.ownerUserId, session.partnerUserId].filter(Boolean) as string[];
    const events = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_event",
      sessionId: session.id,
      limit: 100,
    });
    const participantStates = (session.payload.participantStates as Record<string, unknown> | undefined) ?? {};
    const eventTypes = events.map((event) => event.status).filter(Boolean) as string[];
    const interruptedCount = eventTypes.filter((type) => type === "interrupted").length;
    const returnedCount = eventTypes.filter((type) => type === "returned").length;
    const pausedTonight = eventTypes.includes("paused_tonight");
    const completed = eventTypes.includes("morning_completed") || session.status === "completed";
    for (const userId of users) {
      const partnerUserId = users.find((item) => item !== userId);
      const summary = buildSleepSummaryArtifact({
        session,
        userId,
        partnerUserId,
        participantStates,
        interruptedCount,
        returnedCount,
        pausedTonight,
        completed,
      });
      await this.database.insertFrogSleepEntity({
        id: randomId("sleep_summary"),
        appId: FROGSLEEP_APP_ID,
        kind: "sleep_summary",
        ownerUserId: userId,
        partnerUserId,
        relationshipId: session.relationshipId,
        sessionId: session.id,
        status: "generated",
        payload: {
          session_id: session.id,
          title: summary.headline,
          completed,
          relationship_id: session.relationshipId,
          date_anchor: this.sessionDateAnchor(session),
          started_at: session.startsAt,
          ended_at: session.endsAt,
          participant_state: participantStates[userId] ?? null,
          partner_state: partnerUserId ? participantStates[partnerUserId] ?? null : null,
          interrupted_count: interruptedCount,
          returned_count: returnedCount,
          paused_tonight: pausedTonight,
          telemetry_level: "shared_session_events",
          ...summary,
        },
        createdAt,
        updatedAt: createdAt,
      });
    }
    const recap = buildSleepRecapArtifact({
      requesterUserId: session.ownerUserId as string,
      partnerUserId: session.partnerUserId,
      participantStates,
      interruptedCount,
      returnedCount,
      pausedTonight,
      completed,
    });
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
        title: recap.headline,
        relationship_id: session.relationshipId,
        date_anchor: this.sessionDateAnchor(session),
        completed,
        started_at: session.startsAt,
        ended_at: session.endsAt,
        participant_states: participantStates,
        event_types: eventTypes,
        interrupted_count: interruptedCount,
        returned_count: returnedCount,
        paused_tonight: pausedTonight,
        telemetry_level: "shared_session_events",
        ...recap,
      },
      createdAt,
      updatedAt: createdAt,
    });
  }

}

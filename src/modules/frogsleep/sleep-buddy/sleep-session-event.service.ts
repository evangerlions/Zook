import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { NotificationService } from "../../../services/notification.service.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest, forbidden } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "../buddy-growth/buddy-protected-access.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { optionalIsoTimestamp } from "../frogsleep-validation.ts";
import { toSleepSessionResponse } from "./sleep-buddy-mappers.ts";
import { generateSleepMorningArtifacts } from "./sleep-morning-artifact-writer.ts";
import { queueSleepPush } from "./sleep-notification-policy.ts";
import { SleepRelationshipService } from "./sleep-relationship.service.ts";

const eventTypes = new Set(["interrupted", "returned", "paused_tonight", "morning_completed"]);

/** Records authorized shared-sleep events and produces their summaries and recipient notifications. */
export class SleepSessionEventService {
  constructor(private readonly database: ApplicationDatabase, private readonly notifications?: NotificationService) {}

  async record(userId: string, sessionId: string, eventType: string, metadata: Record<string, unknown>, occurredAt: string) {
    if (!eventTypes.has(eventType)) badRequest("REQ_INVALID_BODY", "Unsupported sleep event type.");
    const timestamp = optionalIsoTimestamp(occurredAt, "occurred_at") ?? new Date().toISOString();
    const session = await this.database.findFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, sessionId);
    if (!session || ![session.ownerUserId, session.partnerUserId].includes(userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Session is not visible to the current user.");
    }
    if (!session.relationshipId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Session relationship is unavailable.");
    return await new SleepRelationshipService(this.database).withSession(userId, session.relationshipId,
      async () => await this.recordSession(userId, sessionId, eventType, metadata, timestamp));
  }

  private async recordSession(userId: string, sessionId: string, eventType: string, metadata: Record<string, unknown>, timestamp: string) {
    const session = await this.database.findFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, sessionId);
    if (!session) forbidden("AUTH_APP_SCOPE_MISMATCH", "Session is unavailable.");
    const relationship = session.relationshipId
      ? await new SleepRelationshipService(this.database).require(userId, session.relationshipId) : undefined;
    if (!relationship || relationship.status !== "active") {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Session relationship is not visible to the current user.");
    }
    await assertBuddyDataAuthorized(this.database, userId, relationship.id, "shared_activity");
    await this.append(session, userId, eventType, metadata, timestamp);
    const updated = await this.update(session, userId, eventType, timestamp);
    if (["morning_completed", "paused_tonight"].includes(eventType)) await generateSleepMorningArtifacts(this.database, updated);
    await this.notify(session, userId, eventType);
    return toSleepSessionResponse(updated, userId);
  }

  private async append(session: FrogSleepEntityRecord, userId: string, eventType: string, payload: Record<string, unknown>, occurredAt: string) {
    const now = new Date().toISOString();
    await this.database.insertFrogSleepEntity({ id: randomId("sleep_event"), appId: FROGSLEEP_APP_ID,
      kind: "sleep_event", ownerUserId: userId, partnerUserId: otherUser(session, userId),
      relationshipId: session.relationshipId, sessionId: session.id, status: eventType,
      occurredAt, payload, createdAt: now, updatedAt: now });
  }

  private async update(session: FrogSleepEntityRecord, userId: string, eventType: string, occurredAt: string) {
    const participantStates = { ...((session.payload.participantStates as Record<string, string> | undefined) ?? {}), [userId]: eventType };
    const updated = await this.database.updateFrogSleepEntity("sleep_session", FROGSLEEP_APP_ID, session.id, {
      status: ["paused_tonight", "morning_completed"].includes(eventType) ? "completed" : "active", occurredAt,
      payload: { ...session.payload, participantStates, lastEventType: eventType } });
    return updated as FrogSleepEntityRecord;
  }

  private async notify(session: FrogSleepEntityRecord, userId: string, eventType: string) {
    const type = eventType === "morning_completed" ? "morning_summary"
      : eventType === "interrupted" ? "shared_session_interrupted"
      : eventType === "returned" ? "shared_session_returned" : undefined;
    if (!type) return;
    await queueSleepPush(this.database, this.notifications, otherUser(session, userId),
      buildFrogSleepNotificationPayload({ type, entityId: session.id, relationshipId: session.relationshipId, sessionId: session.id }));
  }
}

function otherUser(session: FrogSleepEntityRecord, userId: string): string {
  return (session.ownerUserId === userId ? session.partnerUserId : session.ownerUserId) as string;
}

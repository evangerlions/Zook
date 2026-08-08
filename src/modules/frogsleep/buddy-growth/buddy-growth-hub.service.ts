import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { badRequest, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityKind, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "./buddy-protected-access.ts";
import { isBuddyAuthorizationDenied, redactBuddyArtifact } from "./buddy-artifact-redaction.ts";
import { buddyInteractionTypes } from "./buddy-growth-contract.ts";
import { BuddyRateLimiter } from "./buddy-rate-limit.ts";
import { enqueueBuddyGrowthEvent } from "./buddy-growth-events.ts";
import { deriveFocusPresence } from "../focus-buddy/focus-buddy-presence.ts";
import { latestAuthorizedSleepArtifact } from "./buddy-artifact-redaction.ts";

const shareTypes = ["focus_completion", "daily_focus_summary", "sleep_summary", "weekly_progress", "joint_goal_update"] as const;
const activityKinds: FrogSleepEntityKind[] = ["buddy_share", "buddy_interaction", "buddy_joint_activity"];
type PartnerAccumulator = { user_id: string; domains: string[]; relationships: unknown[]; freshness_at: string };

/** Coordinates viewer-filtered buddy hub snapshots, shares, reactions, and joint activities. */
export class BuddyGrowthHubService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager?: KVManager,
  ) {}

  async snapshot(userId: string) {
    const relationships = await this.relationships(userId);
    const partners = new Map<string, PartnerAccumulator>();
    for (const relationship of relationships) {
      const otherUserId = this.otherUserId(relationship, userId);
      const domain = relationship.kind === "sleep_relationship" ? "sleep" : "focus";
      const current = partners.get(otherUserId) ?? {
        user_id: otherUserId, domains: [], relationships: [], freshness_at: relationship.updatedAt,
      };
      current.domains.push(domain);
      current.relationships.push({ relationship_id: relationship.id, domain, status: relationship.status });
      current.freshness_at = current.freshness_at > relationship.updatedAt ? current.freshness_at : relationship.updatedAt;
      partners.set(otherUserId, current);
    }
    const activity = await this.activity(userId, 10);
    const partnerSnapshots = await Promise.all([...partners.values()].map((partner) =>
      this.partnerSnapshot(userId, partner, relationships)));
    return { partners: partnerSnapshots, recent_activity: activity.items,
      recommended_actions: this.recommendedActions(relationships), generated_at: new Date().toISOString() };
  }

  async activity(userId: string, limit = 30, cursor?: string) {
    const relationships = await this.relationships(userId);
    const ids = new Set(relationships.map((item) => item.id));
    const records = (await Promise.all(activityKinds.map((kind) => this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind, limit: 500,
    })))).flat().filter((item) => item.relationshipId && ids.has(item.relationshipId));
    const sorted = records.sort(compareRecords)
      .filter((item) => !cursor || `${item.createdAt}|${item.id}` < cursor).slice(0, limit);
    const items = await Promise.all(sorted.map((item) => this.filteredActivity(userId, item)));
    const last = sorted.at(-1);
    return { items, next_cursor: sorted.length === limit && last ? `${last.createdAt}|${last.id}` : undefined };
  }

  async createShare(userId: string, input: Record<string, unknown>) {
    const type = String(input.type ?? "") as typeof shareTypes[number];
    if (!shareTypes.includes(type)) badRequest("REQ_INVALID_BODY", "Unsupported buddy share type.");
    const relationship = await this.authorizedRelationship(userId, String(input.relationship_id ?? ""),
      type === "weekly_progress" ? "weekly_trend" : "daily_summary");
    const snapshot = minimalSnapshot(type, input.snapshot);
    const expiresAt = expiry(input.expires_at);
    const idempotencyKey = requiredIdempotencyKey(input.idempotency_key);
    return await this.database.withExclusiveSession(async () => {
      const existing = await this.existingByKey("buddy_share", userId, relationship.id, idempotencyKey);
      if (existing) return toActivity(existing);
      const now = new Date().toISOString();
      const record: FrogSleepEntityRecord = { id: randomId("buddy_share"), appId: FROGSLEEP_APP_ID,
        kind: "buddy_share", ownerUserId: userId, partnerUserId: this.otherUserId(relationship, userId),
        relationshipId: relationship.id, status: "active",
        payload: { type, snapshot, expires_at: expiresAt, idempotency_key: idempotencyKey },
        createdAt: now, updatedAt: now };
      await this.database.insertFrogSleepEntity(record);
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: record.partnerUserId!,
        eventType: "interaction_received", targetType: "buddy_share", targetId: record.id,
        relationshipId: relationship.id, deduplicationKey: `share:${record.id}` });
      return toActivity(record);
    });
  }

  async react(userId: string, input: Record<string, unknown>) {
    const type = String(input.type ?? "");
    if (!buddyInteractionTypes.includes(type as typeof buddyInteractionTypes[number])) {
      badRequest("REQ_INVALID_BODY", "Unsupported buddy interaction type.");
    }
    if (this.kvManager) {
      await new BuddyRateLimiter(this.kvManager).assert("interaction", userId, 20, 60 * 60_000);
    }
    const relationship = await this.authorizedRelationship(userId, String(input.relationship_id ?? ""), "shared_activity");
    const idempotencyKey = requiredIdempotencyKey(input.idempotency_key);
    return await this.database.withExclusiveSession(async () => {
      const existing = await this.existingByKey("buddy_interaction", userId, relationship.id, idempotencyKey);
      if (existing) return toActivity(existing);
      const now = new Date().toISOString();
      const record: FrogSleepEntityRecord = { id: randomId("buddy_interaction"), appId: FROGSLEEP_APP_ID,
        kind: "buddy_interaction", ownerUserId: userId, partnerUserId: this.otherUserId(relationship, userId),
        relationshipId: relationship.id, status: "sent",
        payload: { type, context_id: stringOrUndefined(input.context_id), idempotency_key: idempotencyKey },
        createdAt: now, updatedAt: now };
      await this.database.insertFrogSleepEntity(record);
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: record.partnerUserId!,
        eventType: "interaction_received", targetType: "buddy_interaction", targetId: record.id,
        relationshipId: relationship.id, deduplicationKey: `interaction:${record.id}` });
      return toActivity(record);
    });
  }

  async createJointActivity(userId: string, input: Record<string, unknown>) {
    const type = String(input.type ?? "");
    if (!["joint_focus", "tonight_together"].includes(type)) badRequest("REQ_INVALID_BODY", "Unsupported joint activity type.");
    const relationship = await this.authorizedRelationship(userId, String(input.relationship_id ?? ""), "shared_activity");
    const idempotencyKey = requiredIdempotencyKey(input.idempotency_key);
    return await this.database.withExclusiveSession(async () => {
      const existing = await this.existingByKey("buddy_joint_activity", userId, relationship.id, idempotencyKey);
      if (existing) return toActivity(existing);
      const now = new Date().toISOString();
      const record: FrogSleepEntityRecord = { id: randomId("buddy_joint_activity"), appId: FROGSLEEP_APP_ID,
        kind: "buddy_joint_activity", ownerUserId: userId, partnerUserId: this.otherUserId(relationship, userId),
        relationshipId: relationship.id, status: "pending", startsAt: stringOrUndefined(input.starts_at),
        payload: { type, planned_minutes: boundedMinutes(input.planned_minutes), idempotency_key: idempotencyKey },
        createdAt: now, updatedAt: now };
      await this.database.insertFrogSleepEntity(record);
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: record.partnerUserId!,
        eventType: "joint_activity_invited", targetType: "buddy_joint_activity", targetId: record.id,
        relationshipId: relationship.id, deduplicationKey: `joint-activity:${record.id}` });
      return toActivity(record);
    });
  }

  async jointActivityAction(userId: string, activityId: string, action: string) {
    const record = await this.database.findFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, activityId);
    if (!record || !record.relationshipId || ![record.ownerUserId, record.partnerUserId].includes(userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint activity is unavailable.");
    }
    await this.authorizedRelationship(userId, record.relationshipId, "shared_activity");
    const allowed = record.ownerUserId === userId ? ["cancel", "complete"] : ["accept", "decline", "complete"];
    if (!allowed.includes(action)) forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint activity action is unavailable.");
    const status = { accept: "accepted", decline: "declined", cancel: "cancelled", complete: "completed" }[action];
    return await this.database.withExclusiveSession(async () => {
      const updated = await this.database.updateFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID,
        record.id, { status, updatedAt: new Date().toISOString() });
      await enqueueBuddyGrowthEvent(this.database, {
        recipientUserId: record.ownerUserId === userId ? record.partnerUserId! : record.ownerUserId!,
        eventType: "interaction_received", targetType: "buddy_joint_activity", targetId: record.id,
        relationshipId: record.relationshipId!, deduplicationKey: `joint-activity:${record.id}:${action}`,
      });
      return toActivity(updated as FrogSleepEntityRecord);
    });
  }

  private async relationships(userId: string): Promise<FrogSleepEntityRecord[]> {
    const values = await Promise.all((["sleep_relationship", "focus_relationship"] as FrogSleepEntityKind[]).map(async (kind) => [
      ...await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, ownerUserId: userId, limit: 50 }),
      ...await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, partnerUserId: userId, limit: 50 }),
    ]));
    return values.flat().filter((item) => ["active", "accepted"].includes(item.status ?? ""));
  }

  private async existingByKey(
    kind: "buddy_share" | "buddy_interaction" | "buddy_joint_activity",
    userId: string, relationshipId: string, idempotencyKey: string,
  ) {
    return (await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind,
      ownerUserId: userId, relationshipId, limit: 500 }))
      .find((item) => item.payload.idempotency_key === idempotencyKey);
  }

  private async authorizedRelationship(userId: string, relationshipId: string, category: "daily_summary" | "weekly_trend" | "shared_activity") {
    const relationship = (await this.relationships(userId)).find((item) => item.id === relationshipId);
    if (!relationship) forbidden("AUTH_APP_SCOPE_MISMATCH", "Buddy relationship is unavailable.");
    await assertBuddyDataAuthorized(this.database, userId, relationship.id, category);
    return relationship;
  }

  private async filteredActivity(userId: string, record: FrogSleepEntityRecord) {
    if (record.kind === "buddy_share" && String(record.payload.expires_at ?? "") <= new Date().toISOString()) {
      return { id: record.id, ...redactBuddyArtifact(record.kind, "expired") };
    }
    const category = record.kind === "buddy_share" && record.payload.type === "weekly_progress"
      ? "weekly_trend" : record.kind === "buddy_share" ? "daily_summary" : "shared_activity";
    try {
      await assertBuddyDataAuthorized(this.database, userId, record.relationshipId!, category);
      return toActivity(record);
    } catch (error) {
      if (isBuddyAuthorizationDenied(error)) return { id: record.id, ...redactBuddyArtifact(record.kind) };
      throw error;
    }
  }

  private async partnerSnapshot(
    userId: string, partner: PartnerAccumulator, relationships: FrogSleepEntityRecord[],
  ) {
    const partnerRelationships = relationships.filter((item) => this.otherUserId(item, userId) === partner.user_id);
    const focus = partnerRelationships.find((item) => item.kind === "focus_relationship");
    const sleep = partnerRelationships.find((item) => item.kind === "sleep_relationship");
    const identity = await this.database.findUserById(partner.user_id);
    let presence: unknown = null;
    if (focus) {
      try {
        await assertBuddyDataAuthorized(this.database, userId, focus.id, "presence");
        presence = await deriveFocusPresence(this.database, partner.user_id, focus.id, new Date());
      } catch (error) {
        if (!isBuddyAuthorizationDenied(error)) throw error;
      }
    }
    const dailySummary = sleep
      ? await latestAuthorizedSleepArtifact(this.database, userId, [sleep], "sleep_summary")
      : null;
    const nightlyActivity = sleep ? await this.nightlyActivity(userId, sleep) : null;
    return { ...partner, identity: { user_id: partner.user_id,
      display_name: identity?.email?.split("@")[0] ?? partner.user_id }, presence,
      daily_summary: dailySummary, nightly_activity: nightlyActivity,
      goal_preview: null, report_preview: null };
  }

  private async nightlyActivity(userId: string, relationship: FrogSleepEntityRecord) {
    try {
      await assertBuddyDataAuthorized(this.database, userId, relationship.id, "shared_activity");
    } catch (error) {
      if (isBuddyAuthorizationDenied(error)) return null;
      throw error;
    }
    const sessions = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind: "sleep_session", relationshipId: relationship.id, limit: 20,
    });
    const session = sessions.find((item) => ["pending", "active"].includes(item.status ?? ""));
    return session ? { session_id: session.id, status: session.status, starts_at: session.startsAt } : null;
  }

  private otherUserId(relationship: FrogSleepEntityRecord, userId: string) {
    return relationship.ownerUserId === userId ? relationship.partnerUserId! : relationship.ownerUserId!;
  }

  private recommendedActions(relationships: FrogSleepEntityRecord[]) {
    return relationships.length === 0 ? ["invite_buddy"] : ["share_progress", "encourage", "plan_joint_activity"];
  }
}

function minimalSnapshot(type: string, input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) badRequest("REQ_INVALID_BODY", "Share snapshot is required.");
  const source = input as Record<string, unknown>;
  const keys = type.includes("focus") ? ["minutes", "session_count", "completed_at"]
    : type === "sleep_summary" ? ["duration_minutes", "schedule_met", "date"]
    : ["focus_minutes", "sleep_days", "progress", "date"];
  return Object.fromEntries(keys.filter((key) => ["string", "number", "boolean"].includes(typeof source[key]))
    .map((key) => [key, source[key]]));
}

function expiry(value: unknown): string {
  const date = value ? new Date(String(value)) : new Date(Date.now() + 7 * 86_400_000);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.getTime() > Date.now() + 30 * 86_400_000) {
    badRequest("REQ_INVALID_BODY", "Share expiry must be within 30 days.");
  }
  return date.toISOString();
}

function boundedMinutes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) badRequest("REQ_INVALID_BODY", "Invalid planned minutes.");
  return minutes;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredIdempotencyKey(value: unknown): string {
  const key = stringOrUndefined(value);
  if (!key || key.length > 128) badRequest("REQ_INVALID_BODY", "A valid idempotency key is required.");
  return key;
}

function compareRecords(left: FrogSleepEntityRecord, right: FrogSleepEntityRecord) {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function toActivity(record: FrogSleepEntityRecord) {
  return { id: record.id, kind: record.kind, relationship_id: record.relationshipId,
    actor_user_id: record.ownerUserId, partner_user_id: record.partnerUserId,
    status: record.status, starts_at: record.startsAt, payload: record.payload,
    created_at: record.createdAt, updated_at: record.updatedAt };
}

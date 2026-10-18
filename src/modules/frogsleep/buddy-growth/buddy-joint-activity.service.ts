import { isBuddyAuthorizationDenied } from "./buddy-artifact-redaction.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "./buddy-protected-access.ts";
import { buddyRelationships } from "./buddy-relationships.ts";
import { allBuddyRecords, completionFacts } from "./buddy-completion-facts.ts";
import { enqueueBuddyGrowthEvent } from "./buddy-growth-events.ts";

/** Persists activity starts and derives bilateral completion exclusively from terminal session facts. */
export class BuddyJointActivityService {
  constructor(private readonly database: ApplicationDatabase) {}

  async action(userId: string, id: string, action: string) {
    return await this.database.withExclusiveSession(async () => {
      let record = await this.require(userId, id);
      record = await this.reconcile(record);
      const owner = record.ownerUserId === userId;
      if (!(owner ? ["cancel", "start", "complete"] : ["accept", "decline", "start", "complete"]).includes(action)) {
        forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint activity action is unavailable.");
      }
      if (action === "complete") {
        if (record.status !== "completed") conflict("REQ_INVALID_BODY", "Both participants must finish real sessions.");
        return record;
      }
      return await this.transition(record, userId, action);
    });
  }

  async refresh(userId: string) {
    const relationships = (await buddyRelationships(this.database, userId))
      .filter(item => ["active", "accepted"].includes(item.status ?? ""));
    for (const relationship of relationships) {
      const records = await allBuddyRecords(this.database, { kind: "buddy_joint_activity", relationshipId: relationship.id });
      for (const record of records.filter(item => item.status === "accepted")) {
        await this.database.withExclusiveSession(async () => {
          try {
            const current = await this.require(userId, record.id);
            await this.reconcile(current);
          } catch (error) { if (!isBuddyAuthorizationDenied(error)) throw error; }
        });
      }
    }
  }

  private async require(userId: string, id: string) {
    const record = await this.database.findFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, id);
    if (!record?.relationshipId || ![record.ownerUserId, record.partnerUserId].includes(userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint activity is unavailable.");
    }
    await assertBuddyDataAuthorized(this.database, userId, record.relationshipId, "shared_activity");
    return record;
  }

  private async transition(record: FrogSleepEntityRecord, userId: string, action: string) {
    const status = { accept: "accepted", decline: "declined", cancel: "cancelled", start: "accepted" }[action];
    if (record.status === status && action !== "start") return record;
    if (action === "start" ? record.status !== "accepted" :
      action === "cancel" ? !["pending", "accepted"].includes(record.status ?? "") : record.status !== "pending") {
      conflict("REQ_INVALID_BODY", "Invalid joint activity transition.");
    }
    const now = new Date().toISOString();
    if (action === "start" && String(record.payload.expires_at ?? "") <= now) {
      conflict("REQ_INVALID_BODY", "Joint activity has expired.");
    }
    const starts = { ...(record.payload.participant_started_at as Record<string, string> ?? {}) };
    if (action === "start") {
      if (starts[userId]) return record;
      await this.assertNoOtherStartedActivity(record, userId);
      starts[userId] = now;
    }
    return await this.save(record, { status, payload: { ...record.payload, participant_started_at: starts,
      ...(action === "accept" ? { accepted_at: now, expires_at: new Date(Date.now() + 36 * 3600_000).toISOString() } : {}) } });
  }

  private async assertNoOtherStartedActivity(record: FrogSleepEntityRecord, userId: string) {
    const records = await allBuddyRecords(this.database, { kind: "buddy_joint_activity", relationshipId: record.relationshipId });
    if (records.some(item => item.id !== record.id && item.status === "accepted" &&
      String(item.payload.expires_at ?? "") > new Date().toISOString() &&
      (item.payload.participant_started_at as Record<string, string> | undefined)?.[userId])) {
      conflict("REQ_INVALID_BODY", "Finish or cancel the current activity first.");
    }
  }

  private async reconcile(record: FrogSleepEntityRecord) {
    if (record.status !== "accepted") return record;
    const relation = (await buddyRelationships(this.database, record.ownerUserId!)).find(item => item.id === record.relationshipId);
    if (!relation || !["active", "accepted"].includes(relation.status ?? "")) return record;
    const starts = record.payload.participant_started_at as Record<string, string> ?? {};
    const progress: Record<string, unknown> = {};
    for (const userId of [record.ownerUserId!, record.partnerUserId!]) {
      const facts = await completionFacts(this.database, relation, userId);
      const fact = facts.find(fact => fact.kind === (record.payload.type === "joint_focus" ? "focus" : "sleep") &&
        !!starts[userId] && fact.startsAt >= starts[userId] && fact.occurredAt <= String(record.payload.expires_at) &&
        (fact.kind !== "focus" || fact.minutes >= Number(record.payload.planned_minutes ?? 1)));
      progress[userId] = { status: fact ? "completed" : starts[userId] ? "started" : "pending",
        completed_at: fact?.occurredAt, minutes: fact?.minutes };
    }
    const completed = Object.values(progress).every(value => (value as { status: string }).status === "completed");
    const updated = await this.save(record, { status: completed ? "completed" : "accepted",
      payload: { ...record.payload, participant_progress: progress, ...(completed ? { completed_at: new Date().toISOString() } : {}) } });
    if (completed) await this.notifyCompleted(updated);
    return updated;
  }

  private async notifyCompleted(record: FrogSleepEntityRecord) {
    for (const userId of [record.ownerUserId!, record.partnerUserId!]) {
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: userId, eventType: "interaction_received",
        targetType: "buddy_joint_activity", targetId: record.id, relationshipId: record.relationshipId!,
        deduplicationKey: `joint-completed:${record.id}:${userId}` });
    }
  }

  private async save(record: FrogSleepEntityRecord, patch: Partial<FrogSleepEntityRecord>) {
    return (await this.database.updateFrogSleepEntity("buddy_joint_activity", FROGSLEEP_APP_ID, record.id,
      { ...patch, updatedAt: new Date().toISOString() }))!;
  }
}

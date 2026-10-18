import { buddyRelationships, projectBuddyRelationship } from "../buddy-growth/buddy-relationships.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyDomainRelationshipRecord, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { conflict, forbidden } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Resolves sleep runtime relationships from canonical domain facts and legacy records. */
export class SleepRelationshipService {
  constructor(private readonly database: ApplicationDatabase) {}

  async list(userId: string, statuses: string[]) {
    return (await buddyRelationships(this.database, userId, "sleep"))
      .filter(record => statuses.includes(record.status ?? ""));
  }

  async require(userId: string, relationshipId: string): Promise<FrogSleepEntityRecord> {
    const canonical = await this.database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, relationshipId);
    const relationship = canonical
      ? canonical.domain === "sleep" ? projectSleepRelationship(canonical) : undefined
      : await this.database.findFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, relationshipId);
    if (!relationship || relationship.deletedAt || ![relationship.ownerUserId, relationship.partnerUserId].includes(userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Relationship is not visible to the current user.");
    }
    if (!relationship.payload.domain_relationship &&
      !(await buddyRelationships(this.database, userId, "sleep")).some(item => item.id === relationship.id)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Relationship has been superseded by its domain record.");
    }
    return relationship;
  }

  async withSession<T>(userId: string, id: string, operation: () => Promise<T>): Promise<T> {
    const relationship = await this.require(userId, id);
    if (!relationship.payload.domain_relationship) return await this.database.withExclusiveSession(operation);
    const keys = [relationship.ownerUserId!, relationship.partnerUserId!].map(participant =>
      ({ appId: FROGSLEEP_APP_ID, userId: participant, domain: "sleep" as const }));
    return await this.database.withFrogSleepBuddyCommandTransaction(keys, operation);
  }

  async act(userId: string, id: string, action: "pause" | "resume" | "revoke") {
    const relationship = await this.require(userId, id);
    const canonical = await this.database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, id);
    if (!canonical) {
      const status = legacyStatus(relationship.status, action);
      return await this.database.updateFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, id, { status }) as FrogSleepEntityRecord;
    }
    const keys = [canonical.userIdLow, canonical.userIdHigh].map(participant =>
      ({ appId: FROGSLEEP_APP_ID, userId: participant, domain: "sleep" as const }));
    return await this.database.withFrogSleepBuddyCommandTransaction(keys, async () =>
      await this.actLocked(userId, id, action));
  }

  private async actLocked(userId: string, id: string, action: "pause" | "resume" | "revoke") {
    const relationship = await this.database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, id);
    if (!relationship || relationship.status === "revoked") conflict("REQ_INVALID_BODY", "Revoked relationship cannot be changed.");
    const pausedByUserIds = action === "revoke" ? [] : action === "pause"
      ? [...new Set([...relationship.pausedByUserIds, userId])].sort()
      : relationship.pausedByUserIds.filter(participant => participant !== userId);
    const now = new Date().toISOString();
    const updated = await this.database.compareAndUpdateFrogSleepBuddyDomainRelationship({
      appId: FROGSLEEP_APP_ID, id, expectedVersion: relationship.version,
      status: action === "revoke" ? "revoked" : pausedByUserIds.length ? "paused" : "active",
      pausedByUserIds, revokedAt: action === "revoke" ? now : undefined, updatedAt: now,
    });
    if (!updated) conflict("REQ_INVALID_BODY", "Buddy relationship version conflict.");
    if (action === "revoke") await this.releaseSlots(updated);
    return projectSleepRelationship(updated);
  }

  private async releaseSlots(relationship: FrogSleepBuddyDomainRelationshipRecord) {
    for (const userId of [relationship.userIdLow, relationship.userIdHigh]) {
      const slot = await this.database.findFrogSleepBuddyDomainSlot(FROGSLEEP_APP_ID, userId, "sleep");
      if (slot?.relationshipId !== relationship.id) continue;
      const updated = await this.database.compareAndUpdateFrogSleepBuddyDomainSlot({
        appId: FROGSLEEP_APP_ID, userId, domain: "sleep", expectedVersion: slot.version,
        state: "available", updatedAt: new Date().toISOString(),
      });
      if (!updated) conflict("REQ_INVALID_BODY", "Buddy relationship slot version conflict.");
    }
  }
}

export function projectSleepRelationship(relationship: FrogSleepBuddyDomainRelationshipRecord): FrogSleepEntityRecord {
  return projectBuddyRelationship(relationship);
}

function legacyStatus(status: string | undefined, action: "pause" | "resume" | "revoke") {
  if (action === "pause" && status === "active") return "paused";
  if (action === "resume" && status === "paused") return "active";
  if (action === "revoke" && ["active", "paused"].includes(status ?? "")) return "revoked";
  conflict("REQ_INVALID_BODY", "Relationship action is not valid for the current status.");
}

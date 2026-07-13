import { randomUUID } from "node:crypto";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { ApplicationError, badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepBuddySharingGrantRecord, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";
import { buddySharingCategories, type BuddySharingCategory } from "./buddy-growth-contract.ts";
import { limitBuddyUnauthorizedAccess } from "./buddy-rate-limit.ts";

/** Owns directional buddy sharing grants and participant authorization. */
export class BuddyConsentService {
  constructor(private readonly database: ApplicationDatabase) {}

  async createAcceptanceGrants(input: {
    relationshipId: string; domain: "sleep" | "focus"; inviterUserId: string; inviteeUserId: string;
    proposedCategories: string[]; selectedCategories: string[];
  }): Promise<FrogSleepBuddySharingGrantRecord[]> {
    const proposed = this.validCategories(input.proposedCategories);
    const selected = this.validCategories(input.selectedCategories).filter((category) => proposed.includes(category));
    const records = [
      ...proposed.map((category) => this.newGrant(input, input.inviterUserId, input.inviteeUserId, category, "granted")),
      ...proposed.map((category) => this.newGrant(input, input.inviteeUserId, input.inviterUserId, category,
        selected.includes(category) ? "granted" : "revoked")),
    ];
    const grants = await Promise.all(records.map((record) => this.database.upsertFrogSleepBuddySharingGrant(record)));
    await Promise.all(grants.map((grant) => this.recordAudit(grant, "buddy_grant_created")));
    return grants;
  }

  async list(userId: string, relationshipId: string) {
    await this.authorizedRelationship(userId, relationshipId);
    const grants = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
    return { relationship_id: relationshipId, viewer_user_id: userId, grants: grants.map(toPayload) };
  }

  async update(userId: string, relationshipId: string, grantId: string, expectedVersion: number, state: string) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !["granted", "revoked"].includes(state)) {
      badRequest("REQ_INVALID_BODY", "Invalid grant state or expected version.");
    }
    await this.authorizedRelationship(userId, relationshipId);
    return await this.database.withExclusiveSession(async () => {
      const grant = await this.database.findFrogSleepBuddySharingGrant(FROGSLEEP_APP_ID, grantId);
      if (!grant || grant.relationshipId !== relationshipId) throw unavailable();
      if (grant.grantorUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the grantor can update this grant.");
      if (grant.version !== expectedVersion) conflict("REQ_INVALID_BODY", "Buddy sharing grant version conflict.");
      const updated = await this.database.updateFrogSleepBuddySharingGrant(
        FROGSLEEP_APP_ID, grantId, expectedVersion, state as "granted" | "revoked",
      );
      if (!updated) conflict("REQ_INVALID_BODY", "Buddy sharing grant version conflict.");
      await this.recordAudit(updated, "buddy_grant_updated");
      return toPayload(updated);
    });
  }

  async assertAuthorized(userId: string, relationshipId: string, category: BuddySharingCategory) {
    const relationship = await this.authorizedRelationship(userId, relationshipId);
    const otherUserId = relationship.ownerUserId === userId ? relationship.partnerUserId : relationship.ownerUserId;
    let grants = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
    if (grants.length === 0) {
      grants = await this.backfillLegacyRelationshipGrants(relationship);
    }
    const allowed = grants.some((grant) => grant.grantorUserId === otherUserId && grant.granteeUserId === userId &&
      grant.category === category && grant.state === "granted");
    if (!allowed) {
      limitBuddyUnauthorizedAccess(userId);
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Buddy data is not shared with this viewer.");
    }
  }

  private async backfillLegacyRelationshipGrants(
    relationship: FrogSleepEntityRecord,
  ): Promise<FrogSleepBuddySharingGrantRecord[]> {
    const ownerUserId = relationship.ownerUserId as string;
    const partnerUserId = relationship.partnerUserId as string;
    const domain = relationship.kind === "focus_relationship" ? "focus" : "sleep";
    const input = { relationshipId: relationship.id, domain } as const;
    const records = buddySharingCategories.flatMap((category) => [
      this.newGrant(input, ownerUserId, partnerUserId, category, "granted"),
      this.newGrant(input, partnerUserId, ownerUserId, category, "granted"),
    ]);
    const grants = await Promise.all(records.map((record) =>
      this.database.upsertFrogSleepBuddySharingGrant(record)));
    await Promise.all(grants.map((grant) => this.recordAudit(grant, "buddy_grant_legacy_backfilled")));
    return grants;
  }

  private async authorizedRelationship(userId: string, relationshipId: string): Promise<FrogSleepEntityRecord> {
    const relationship = await this.findRelationship(relationshipId);
    if (!relationship || !relationship.ownerUserId || !relationship.partnerUserId ||
        ![relationship.ownerUserId, relationship.partnerUserId].includes(userId)) throw unavailable();
    if (!["active", "accepted"].includes(relationship.status ?? "")) throw unavailable();
    await assertBuddyPairNotBlocked(this.database, relationship.ownerUserId, relationship.partnerUserId);
    return relationship;
  }

  private async findRelationship(relationshipId: string) {
    return await this.database.findFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, relationshipId)
      ?? await this.database.findFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, relationshipId);
  }

  private validCategories(values: string[]): BuddySharingCategory[] {
    return [...new Set(values.filter((value): value is BuddySharingCategory =>
      buddySharingCategories.includes(value as BuddySharingCategory)))];
  }

  private newGrant(
    input: { relationshipId: string; domain: "sleep" | "focus" },
    grantorUserId: string, granteeUserId: string, category: BuddySharingCategory,
    state: "granted" | "revoked",
  ): FrogSleepBuddySharingGrantRecord {
    const now = new Date().toISOString();
    return { id: randomUUID(), appId: FROGSLEEP_APP_ID, relationshipId: input.relationshipId,
      grantorUserId, granteeUserId, domain: input.domain, category, state, version: 1,
      grantedAt: state === "granted" ? now : undefined, revokedAt: state === "revoked" ? now : undefined,
      createdAt: now, updatedAt: now };
  }

  private async recordAudit(grant: FrogSleepBuddySharingGrantRecord, action: string): Promise<void> {
    await this.database.insertAuditLog({ id: randomUUID(), appId: FROGSLEEP_APP_ID,
      actorUserId: grant.grantorUserId, action, resourceType: "buddy_sharing_grant",
      resourceId: grant.id, resourceOwnerUserId: grant.grantorUserId,
      payload: { relationship_id: grant.relationshipId, domain: grant.domain, category: grant.category,
        state: grant.state, version: grant.version }, createdAt: new Date().toISOString() });
  }
}

function unavailable(): ApplicationError {
  return new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy relationship is not available.");
}

function toPayload(grant: FrogSleepBuddySharingGrantRecord) {
  return { id: grant.id, relationship_id: grant.relationshipId, grantor_user_id: grant.grantorUserId,
    grantee_user_id: grant.granteeUserId, domain: grant.domain, category: grant.category,
    state: grant.state, version: grant.version, granted_at: grant.grantedAt, revoked_at: grant.revokedAt,
    created_at: grant.createdAt, updated_at: grant.updatedAt };
}

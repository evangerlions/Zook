import { closeBuddySharedSessions } from "./buddy-relationship-cleanup.ts";
import { buddyRelationshipSlotKeys, requireBuddyRelationship } from "./buddy-relationship-facts.ts";
import { createHash, randomUUID } from "node:crypto";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { ApplicationError, badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepBuddySharingGrantRecord, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";
import { buddySharingCategories, type BuddySharingCategory } from "./buddy-growth-contract.ts";
import { limitBuddyUnauthorizedAccess } from "./buddy-rate-limit.ts";

/** Owns directional buddy sharing grants and participant authorization. */
export class BuddyConsentService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager?: KVManager,
  ) {}

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

  async createIndependentGrants(input: {
    relationshipId: string; domain: "sleep" | "focus"; inviterUserId: string; inviteeUserId: string;
  }) {
    for (const category of buddySharingCategories) {
      for (const [grantor, grantee] of [[input.inviterUserId, input.inviteeUserId], [input.inviteeUserId, input.inviterUserId]]) {
        const grant = await this.database.upsertFrogSleepBuddySharingGrant(this.newGrant(input, grantor!, grantee!, category, "revoked"));
        await this.recordAudit(grant, "buddy_grant_created");
      }
    }
  }

  async list(userId: string, relationshipId: string) {
    const relationship = await this.authorizedRelationship(userId, relationshipId, false);
    const grants = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
    return { relationship_id: relationshipId, viewer_user_id: userId, grants: (relationship.payload.canonical ? this.completeGrants(relationship, grants) : grants).map(toPayload) };
  }

  async update(userId: string, relationshipId: string, grantId: string, expectedVersion: number, state: string) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !["granted", "revoked"].includes(state)) {
      badRequest("REQ_INVALID_BODY", "Invalid grant state or expected version.");
    }
    const relationship = await this.authorizedRelationship(userId, relationshipId, state === "granted");
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(relationship), async () => {
      await this.authorizedRelationship(userId, relationshipId, state === "granted");
      const grant = await this.database.findFrogSleepBuddySharingGrant(FROGSLEEP_APP_ID, grantId);
      if (!grant || grant.relationshipId !== relationshipId) throw unavailable();
      if (grant.grantorUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the grantor can update this grant.");
      if (grant.version !== expectedVersion) conflict("REQ_INVALID_BODY", "Buddy sharing grant version conflict.");
      const updated = await this.database.updateFrogSleepBuddySharingGrant(
        FROGSLEEP_APP_ID, grantId, expectedVersion, state as "granted" | "revoked",
      );
      if (!updated) conflict("REQ_INVALID_BODY", "Buddy sharing grant version conflict.");
      await this.recordAudit(updated, "buddy_grant_updated");
      if (updated.category === "shared_activity" && updated.state === "revoked") {
        await closeBuddySharedSessions(this.database, relationshipId);
      }
      return toPayload(updated);
    });
  }

  async assertAuthorized(userId: string, relationshipId: string, category: BuddySharingCategory) {
    const relationship = await this.authorizedRelationship(userId, relationshipId);
    const otherUserId = relationship.ownerUserId === userId ? relationship.partnerUserId : relationship.ownerUserId;
    let grants = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
    if (grants.length === 0 && !relationship.payload.canonical) {
      grants = await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(relationship), async () => {
        const current = await this.authorizedRelationship(userId, relationshipId);
        const existing = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
        return existing.length ? existing : await this.backfillLegacyRelationshipGrants(current);
      });
    }
    const current = await this.authorizedRelationship(userId, relationshipId);
    const currentGrants = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
    const domain = current.kind === "sleep_relationship" ? "sleep" : "focus";
    const allowed = currentGrants.some((grant) => grant.domain === domain && grant.grantorUserId === otherUserId && grant.granteeUserId === userId &&
      grant.category === category && grant.state === "granted" &&
      grants.some(initial => initial.id === grant.id && initial.version === grant.version && initial.state === "granted"));
    if (!allowed) {
      if (this.kvManager) {
        await limitBuddyUnauthorizedAccess(this.kvManager, userId);
      }
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

  private async authorizedRelationship(userId: string, relationshipId: string, active = true): Promise<FrogSleepEntityRecord> {
    const relationship = await requireBuddyRelationship(this.database, userId, relationshipId);
    const allowed = active ? ["active", "accepted"] : ["active", "accepted", "paused"];
    if (!allowed.includes(relationship.status ?? "")) throw unavailable();
    await assertBuddyPairNotBlocked(this.database, relationship.ownerUserId!, relationship.partnerUserId!);
    return relationship;
  }

  async replaceOwn(userId: string, relationshipId: string, domain: string, categories: string[], versions: Record<string, number>) {
    if (!["sleep", "focus"].includes(domain) || categories.some((value) => !buddySharingCategories.includes(value as BuddySharingCategory))
      || buddySharingCategories.some((value) => !Number.isInteger(versions[value]) || versions[value]! < 0)) {
      badRequest("REQ_INVALID_BODY", "Invalid sharing categories or expected versions.");
    }
    const row = await this.authorizedRelationship(userId, relationshipId, false);
    if (domain !== (row.kind === "sleep_relationship" ? "sleep" : "focus")) badRequest("REQ_INVALID_BODY", "Relationship domain mismatch.");
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(row), async () => {
      const current = await this.authorizedRelationship(userId, relationshipId, false);
      const actual = await this.database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
      const own = this.completeGrants(current, actual).filter((grant) => grant.grantorUserId === userId);
      if (own.some((grant) => categories.includes(grant.category) && grant.state !== "granted")) {
        await this.authorizedRelationship(userId, relationshipId, true);
      }
      if (own.some((grant) => grant.version !== versions[grant.category])) conflict("REQ_INVALID_BODY", "Buddy grant version conflict.");
      for (const grant of own) await this.replaceGrant(grant, categories.includes(grant.category));
      if (own.some(grant => grant.category === "shared_activity" && grant.state === "granted" && !categories.includes("shared_activity"))) {
        await closeBuddySharedSessions(this.database, relationshipId);
      }
      return await this.list(userId, relationshipId);
    });
  }

  private async replaceGrant(grant: FrogSleepBuddySharingGrantRecord, selected: boolean) {
    const state = selected ? "granted" : "revoked";
    if (grant.state === state) return;
    const updated = grant.version === 0
      ? await this.database.upsertFrogSleepBuddySharingGrant({ ...grant, version: 1, state,
        grantedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      : await this.database.updateFrogSleepBuddySharingGrant(FROGSLEEP_APP_ID, grant.id, grant.version, state);
    if (!updated) conflict("REQ_INVALID_BODY", "Buddy grant version conflict.");
    await this.recordAudit(updated, "buddy_grant_updated");
  }

  private completeGrants(row: FrogSleepEntityRecord, actual: FrogSleepBuddySharingGrantRecord[]) {
    const domain = row.kind === "sleep_relationship" ? "sleep" : "focus";
    const result: FrogSleepBuddySharingGrantRecord[] = [];
    for (const grantor of [row.ownerUserId!, row.partnerUserId!]) {
      const grantee = grantor === row.ownerUserId ? row.partnerUserId! : row.ownerUserId!;
      for (const category of buddySharingCategories) {
        const found = actual.find((value) => value.grantorUserId === grantor && value.granteeUserId === grantee && value.category === category && value.domain === domain);
        const id = createHash("sha256").update(`${FROGSLEEP_APP_ID}|${row.id}|${grantor}|${grantee}|${category}`).digest("hex");
        result.push(found ?? { id: `buddy_grant_${id}`, appId: FROGSLEEP_APP_ID, relationshipId: row.id,
          domain, category, grantorUserId: grantor, granteeUserId: grantee, state: "revoked", version: 0,
          createdAt: row.createdAt, updatedAt: row.updatedAt });
      }
    }
    return result;
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

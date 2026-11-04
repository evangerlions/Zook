import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { conflict } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buddyRelationshipSlotKeys, currentBuddyRelationships } from "./buddy-relationship-facts.ts";

/** Terminates a relationship under its participant locks and releases only its own slots. */
export async function revokeBuddyRelationship(database: ApplicationDatabase, relationship: FrogSleepEntityRecord) {
  const now = new Date().toISOString();
  if (relationship.payload.canonical) {
    if (relationship.status !== "revoked") {
      const updated = await database.compareAndUpdateFrogSleepBuddyDomainRelationship({ appId: FROGSLEEP_APP_ID,
        id: relationship.id, expectedVersion: Number(relationship.payload.version), status: "revoked",
        pausedByUserIds: [], revokedAt: now, updatedAt: now });
      if (!updated) conflict("REQ_INVALID_BODY", "Buddy relationship version conflict.");
    }
  } else if (relationship.status !== "revoked") {
    await database.updateFrogSleepEntity(relationship.kind, FROGSLEEP_APP_ID, relationship.id,
      { status: "revoked", payload: { ...relationship.payload, paused_by_user_ids: [],
        version: Number(relationship.payload.version ?? 1) + 1 } });
  }
  await releaseSlots(database, relationship, now);
  await revokeSharingGrants(database, relationship.id);
  await closeBuddySharedSessions(database, relationship.id);
}

async function releaseSlots(database: ApplicationDatabase, relationship: FrogSleepEntityRecord, now: string) {
  for (const key of buddyRelationshipSlotKeys(relationship)) {
    const slot = await database.findFrogSleepBuddyDomainSlot(key.appId, key.userId, key.domain);
    if (!slot || slot.relationshipId !== relationship.id) continue;
    const updated = await database.compareAndUpdateFrogSleepBuddyDomainSlot({ ...key,
      expectedVersion: slot.version, state: "available", updatedAt: now });
    if (!updated) conflict("REQ_INVALID_BODY", "Buddy slot version conflict.");
  }
}

/** Revokes both directions without re-creating grants on later reads. */
export async function revokeSharingGrants(database: ApplicationDatabase, relationshipId: string) {
  const grants = await database.listFrogSleepBuddySharingGrants(FROGSLEEP_APP_ID, relationshipId);
  for (const grant of grants.filter((value) => value.state === "granted")) {
    const updated = await database.updateFrogSleepBuddySharingGrant(FROGSLEEP_APP_ID, grant.id, grant.version, "revoked");
    if (!updated) conflict("REQ_INVALID_BODY", "Buddy grant version conflict.");
  }
}

/** Closes shared coordination sessions, leaving private Sleep and Focus histories untouched. */
export async function closeBuddySharedSessions(database: ApplicationDatabase, relationshipId: string) {
  for (const kind of ["sleep_session", "buddy_joint_activity"] as const) {
    const rows = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, relationshipId, limit: 500 });
    for (const row of rows.filter((value) => ["pending", "active", "accepted", "proposed"].includes(value.status ?? ""))) {
      await database.updateFrogSleepEntity(kind, FROGSLEEP_APP_ID, row.id, { status: "cancelled" });
    }
  }
}

/** Revokes every domain between a blocked pair inside the caller's two-domain transaction. */
export async function revokeBlockedBuddyPair(database: ApplicationDatabase, actor: string, partner: string) {
  const relationships = await currentBuddyRelationships(database, actor);
  // Public listings hide compatibility rows shadowed by canonical facts; safety cleanup must close those rows too.
  for (const kind of ["sleep_relationship", "focus_relationship"] as const) {
    for (const field of ["ownerUserId", "partnerUserId"] as const) {
      const legacy = await database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, [field]: actor, limit: 500 });
      relationships.push(...legacy.filter(row => ["active", "accepted", "paused"].includes(row.status ?? "")));
    }
  }
  for (const row of [...new Map(relationships.map(value => [value.id, value])).values()]
    .filter((value) => [value.ownerUserId, value.partnerUserId].includes(partner))) {
    await revokeBuddyRelationship(database, row);
  }
}

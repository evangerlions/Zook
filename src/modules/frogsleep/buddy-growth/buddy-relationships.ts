import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord, FrogSleepBuddyDomainRelationshipRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Reads canonical domain relationships through the same runtime projection on every buddy surface. */
export async function buddyRelationships(database: ApplicationDatabase, userId: string, domain?: "focus" | "sleep") {
  const domains = domain ? [domain] : ["focus", "sleep"] as const;
  const lists = await Promise.all(domains.map(async domain => {
    const canonical = await database.listCurrentFrogSleepBuddyDomainRelationships(FROGSLEEP_APP_ID, userId, domain, true);
    const kind = domain === "focus" ? "focus_relationship" : "sleep_relationship";
    const legacy = (await Promise.all([
      database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, ownerUserId: userId, limit: 500 }),
      database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, partnerUserId: userId, limit: 500 }),
    ])).flat();
    const values = canonical.map(projectBuddyRelationship);
    return [...values, ...legacy.filter(item => !values.some(value => value.id === item.id ||
      other(value, userId) === other(item, userId)))];
  }));
  return [...new Map(lists.flat().map(item => [item.id, item])).values()].filter(item => !item.deletedAt);
}

export function projectBuddyRelationship(record: FrogSleepBuddyDomainRelationshipRecord): FrogSleepEntityRecord {
  return { id: record.id, appId: record.appId, kind: record.domain === "sleep" ? "sleep_relationship" : "focus_relationship",
    ownerUserId: record.userIdLow, partnerUserId: record.userIdHigh,
    status: record.domain === "focus" && record.status === "active" ? "accepted" : record.status,
    payload: { domain_relationship: true, version: record.version, paused_by_user_ids: record.pausedByUserIds },
    createdAt: record.createdAt, updatedAt: record.updatedAt };
}

function other(record: FrogSleepEntityRecord, userId: string) {
  return record.ownerUserId === userId ? record.partnerUserId : record.ownerUserId;
}

/** Releases the two canonical slots atomically when a participant ends their focus relationship. */
export async function revokeFocusDomainRelationship(database: ApplicationDatabase, userId: string, id: string) {
  const record = await database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, id);
  if (!record || record.domain !== "focus" || ![record.userIdLow, record.userIdHigh].includes(userId)) return undefined;
  const keys = [record.userIdLow, record.userIdHigh].map(userId => ({ appId: FROGSLEEP_APP_ID, userId, domain: "focus" as const }));
  return await database.withFrogSleepBuddyCommandTransaction(keys, async () => {
    const current = (await database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, id))!;
    if (current.status === "revoked") return projectBuddyRelationship(current);
    const now = new Date().toISOString();
    const updated = await database.compareAndUpdateFrogSleepBuddyDomainRelationship({ appId: FROGSLEEP_APP_ID, id,
      expectedVersion: current.version, status: "revoked", pausedByUserIds: [], revokedAt: now, updatedAt: now });
    if (!updated) throw new Error("Concurrent buddy relationship change.");
    for (const key of keys) {
      const slot = await database.findFrogSleepBuddyDomainSlot(key.appId, key.userId, key.domain);
      if (slot?.relationshipId !== id) continue;
      const released = await database.compareAndUpdateFrogSleepBuddyDomainSlot({ ...key,
        expectedVersion: slot.version, state: "available", updatedAt: now });
      if (!released) throw new Error("Concurrent buddy slot change.");
    }
    return projectBuddyRelationship(updated);
  });
}

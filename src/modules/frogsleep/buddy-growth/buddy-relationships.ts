import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord, FrogSleepBuddyDomainRelationshipRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Reads canonical domain relationships through the same runtime projection on every buddy surface. */
export async function buddyRelationships(database: ApplicationDatabase, userId: string, domain?: "focus" | "sleep") {
  const domains = domain ? [domain] : ["focus", "sleep"] as const;
  const lists = await Promise.all(domains.map(async domain => {
    const canonical = await database.listCurrentFrogSleepBuddyDomainRelationships(FROGSLEEP_APP_ID, userId, domain);
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

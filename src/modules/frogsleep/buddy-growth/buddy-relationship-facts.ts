import { buddyRelationships } from "./buddy-relationships.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Projects canonical and compatibility relationships without duplicating relationship facts. */
export async function findBuddyRelationship(database: ApplicationDatabase, id: string) {
  const canonical = await database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, id);
  if (canonical) return { id, appId: canonical.appId,
    kind: canonical.domain === "sleep" ? "sleep_relationship" : "focus_relationship",
    ownerUserId: canonical.userIdLow, partnerUserId: canonical.userIdHigh, status: canonical.status,
    payload: { canonical: true, version: canonical.version, paused_by_user_ids: canonical.pausedByUserIds },
    createdAt: canonical.createdAt, updatedAt: canonical.updatedAt } satisfies FrogSleepEntityRecord;
  const legacy = await database.findFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, id)
    ?? await database.findFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, id);
  if (!legacy?.ownerUserId || !legacy.partnerUserId) return legacy;
  const domain = legacy.kind === "sleep_relationship" ? "sleep" : "focus";
  const history = await database.listCurrentFrogSleepBuddyDomainRelationships(FROGSLEEP_APP_ID, legacy.ownerUserId, domain, true);
  // A canonical relationship remains authoritative after revocation, including direct legacy-ID requests.
  if (history.some(row => [row.userIdLow, row.userIdHigh].includes(legacy.partnerUserId!))) return undefined;
  return legacy;
}

/** Checks membership even for terminal relationship receipts. */
export async function requireBuddyRelationship(database: ApplicationDatabase, actor: string, id: string) {
  const relationship = await findBuddyRelationship(database, id);
  if (!relationship?.ownerUserId || !relationship.partnerUserId
    || !["active", "accepted", "paused", "revoked"].includes(relationship.status ?? "")
    || ![relationship.ownerUserId, relationship.partnerUserId].includes(actor)) {
    throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy relationship is unavailable.");
  }
  return relationship;
}

/** Lists only current canonical or compatibility relationships belonging to a viewer. */
export async function currentBuddyRelationships(database: ApplicationDatabase, actor: string) {
  const relationships = (await buddyRelationships(database, actor))
    .filter(row => ["active", "accepted", "paused"].includes(row.status ?? ""));
  const result: FrogSleepEntityRecord[] = [];
  for (const row of relationships) {
    const current = await findBuddyRelationship(database, row.id);
    if (current && ["active", "accepted", "paused"].includes(current.status ?? "")) result.push(current);
  }
  return result;
}

/** Uses the same participant/domain locks as invitation acceptance. */
export function buddyRelationshipSlotKeys(relationship: FrogSleepEntityRecord) {
  const domain = relationship.kind === "sleep_relationship" ? "sleep" : "focus";
  return [relationship.ownerUserId!, relationship.partnerUserId!].map((userId) =>
    ({ appId: FROGSLEEP_APP_ID, userId, domain } as const));
}

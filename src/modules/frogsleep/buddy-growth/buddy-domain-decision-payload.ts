import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord } from "../../../shared/types.ts";

/** Reads per-domain decisions without replacing legacy Bundle facts or mutating consent. */
export async function buddyDomainDecisionPayload(database: ApplicationDatabase, bundle: FrogSleepBuddyInvitationBundleRecord) {
  const results = [];
  for (const domain of bundle.domains) {
    const decision = await database.findFrogSleepBuddyInvitationDomainDecision(bundle.appId, bundle.id, domain);
    const slot = bundle.inviteeUserId && decision?.status === "accepted"
      ? await database.findFrogSleepBuddyDomainSlot(bundle.appId, bundle.inviteeUserId, domain) : undefined;
    const relationship = slot?.relationshipId
      ? await database.findFrogSleepBuddyDomainRelationship(bundle.appId, slot.relationshipId) : undefined;
    const matches = relationship?.domain === domain && relationship?.createdAt === decision?.decidedAt &&
      [relationship?.userIdLow, relationship?.userIdHigh].includes(bundle.inviterUserId) &&
      [relationship?.userIdLow, relationship?.userIdHigh].includes(bundle.inviteeUserId);
    results.push({ domain, relationship_id: matches ? relationship!.id : null,
      status: decision?.status === "pending" && bundle.status !== "pending" ? bundle.status : decision?.status ?? bundle.status, decision_version: decision?.version,
      error_code: decision?.status === "accepted" && !matches ? "BUDDY_RELATIONSHIP_UNAVAILABLE"
        : bundle.domainErrorCodes[domain] ?? null });
  }
  return results;
}

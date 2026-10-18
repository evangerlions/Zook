import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord, FrogSleepBuddyInvitationDomainDecisionRecord } from "../../../shared/types.ts";

type Status = FrogSleepBuddyInvitationDomainDecisionRecord["status"];

/** Projects independent domain facts; aggregate versions never substitute for decision versions. */
export async function invitationDomainPreview(database: ApplicationDatabase,
  bundle: FrogSleepBuddyInvitationBundleRecord, viewerUserId: string) {
  const decisions = await database.listFrogSleepBuddyInvitationDomainDecisions(bundle.appId, bundle.id);
  const results = [];
  for (const domain of bundle.domains) {
    const decision = decisions.find((item) => item.domain === domain);
    const childId = bundle.domainInvitationIds[domain];
    const child = childId ? await database.findFrogSleepEntity(`${domain}_invite`, bundle.appId, childId) : undefined;
    const terminalChild = child && child.status !== "pending" ? child : undefined;
    const status = effectiveStatus(bundle, decision, terminalChild?.status as Status | undefined);
    const canonical = decision && (decision.status !== "pending" || !terminalChild) && decision.terminalReason !== "legacy_aggregate";
    const pending = status === "pending";
    const actions = !pending ? [] : viewerUserId === bundle.inviterUserId ? ["cancel"] : ["accept", "decline"];
    results.push({ domain, status, relationship_id: decision?.relationshipId ?? terminalChild?.relationshipId ?? null,
      decision_version: canonical ? decision.version : undefined, viewer_actions: actions,
      error_code: canonical ? null : bundle.domainErrorCodes[domain] ?? null });
  }
  return results;
}

function effectiveStatus(bundle: FrogSleepBuddyInvitationBundleRecord,
  decision: FrogSleepBuddyInvitationDomainDecisionRecord | undefined, childStatus: Status | undefined): Status {
  if (decision && decision.status !== "pending") return decision.status;
  if (childStatus) return childStatus;
  if (bundle.status !== "pending") return bundle.status;
  return Date.parse(bundle.expiresAt) <= Date.now() ? "expired" : "pending";
}

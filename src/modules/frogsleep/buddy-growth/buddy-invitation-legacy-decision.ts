import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord } from "../../../shared/types.ts";
import { conflict } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";

/** Prevents compatibility commands from deciding a domain already handled by the new protocol. */
export async function assertAggregateCompatible(database: ApplicationDatabase, bundle: FrogSleepBuddyInvitationBundleRecord) {
  const decisions = await database.listFrogSleepBuddyInvitationDomainDecisions(bundle.appId, bundle.id);
  if (decisions.some((item) => item.status !== "pending" && item.terminalReason !== "legacy_aggregate")) {
    conflict("REQ_INVALID_BODY", "Use per-domain commands for this invitation.");
  }
}

export async function recordLegacyDecisions(database: ApplicationDatabase, bundle: FrogSleepBuddyInvitationBundleRecord,
  actorUserId: string, action: "accept" | "decline" | "cancel", idempotencyKey: string,
  results: Array<Record<string, unknown>>) {
  for (const result of results) {
    if (result.error_code) continue;
    const domain = result.domain as "sleep" | "focus";
    const decision = await database.findFrogSleepBuddyInvitationDomainDecision(bundle.appId, bundle.id, domain);
    if (!decision) continue;
    if (decision.status !== "pending" && decision.terminalReason === "legacy_aggregate") continue;
    const now = new Date().toISOString();
    const updated = await database.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({ appId: bundle.appId,
      invitationId: bundle.id, domain, expectedVersion: decision.version,
      status: action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled",
      decidedByUserId: actorUserId, decidedAt: now, idempotencyKeyHash: sha256(`${idempotencyKey}:${domain}`),
      relationshipId: typeof result.relationship_id === "string" ? result.relationship_id : undefined,
      terminalReason: "legacy_aggregate", updatedAt: now });
    if (!updated) conflict("REQ_INVALID_BODY", "Buddy invitation decision version conflict.");
  }
}

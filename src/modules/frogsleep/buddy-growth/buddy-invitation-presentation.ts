import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord } from "../../../shared/types.ts";

/** Derives list state from independent decisions and durable viewer read timestamps. */
export function invitationAggregateStatus(statuses: string[]) {
  if (statuses.some(status => status === "pending")) return "pending";
  if (statuses.every(status => status === "accepted")) return "accepted";
  if (statuses.some(status => status === "cancelled")) return "cancelled";
  if (statuses.some(status => status === "declined")) return "declined";
  return "expired";
}

export async function invitationUnread(database: ApplicationDatabase,
  bundle: FrogSleepBuddyInvitationBundleRecord, viewer: string) {
  const decisions = await database.listFrogSleepBuddyInvitationDomainDecisions(bundle.appId, bundle.id);
  const changedAt = Math.max(Date.parse(bundle.updatedAt), ...decisions.map(item => Date.parse(item.updatedAt)));
  const readAt = viewer === bundle.inviterUserId ? bundle.inviterReadAt ?? bundle.createdAt : bundle.inviteeReadAt;
  return !readAt || Date.parse(readAt) < changedAt;
}

export async function existingInvitationRelationship(database: ApplicationDatabase,
  bundle: Pick<FrogSleepBuddyInvitationBundleRecord, "appId" | "inviterUserId" | "inviteeUserId">, domain: "sleep" | "focus") {
  if (!bundle.inviteeUserId) return undefined;
  const current = await database.listCurrentFrogSleepBuddyDomainRelationships(bundle.appId, bundle.inviterUserId, domain);
  return current.find(item => ["active", "paused"].includes(item.status)
    && [item.userIdLow, item.userIdHigh].includes(bundle.inviteeUserId!));
}

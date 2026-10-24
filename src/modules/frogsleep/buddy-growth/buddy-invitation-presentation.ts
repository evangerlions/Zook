import { canonicalFrogSleepBuddyParticipants } from "./buddy-domain-relationship-validation.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord, FrogSleepBuddyDomainRelationshipRecord } from "../../../shared/types.ts";

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
  const history = await database.listCurrentFrogSleepBuddyDomainRelationships(bundle.appId, bundle.inviterUserId, domain, true);
  const pair = history.filter(item => [item.userIdLow, item.userIdHigh].includes(bundle.inviteeUserId!));
  if (pair.length) return pair.find(item => ["active", "paused"].includes(item.status));
  return await legacyInvitationRelationship(database, bundle, domain);
}

async function legacyInvitationRelationship(database: ApplicationDatabase,
  bundle: Pick<FrogSleepBuddyInvitationBundleRecord, "appId" | "inviterUserId" | "inviteeUserId">, domain: "sleep" | "focus") {
  const kind = domain === "sleep" ? "sleep_relationship" : "focus_relationship";
  const owned = await database.listFrogSleepEntities({ appId: bundle.appId, kind, ownerUserId: bundle.inviterUserId, limit: 500 });
  const received = await database.listFrogSleepEntities({ appId: bundle.appId, kind, partnerUserId: bundle.inviterUserId, limit: 500 });
  const relationship = [...owned, ...received].find(item => !item.deletedAt
    && ["active", "accepted", "paused"].includes(item.status ?? "")
    && [item.ownerUserId, item.partnerUserId].includes(bundle.inviteeUserId!));
  if (!relationship) return undefined;
  return { id: relationship.id, appId: bundle.appId, domain,
    ...canonicalFrogSleepBuddyParticipants(relationship.ownerUserId!, relationship.partnerUserId!),
    status: relationship.status === "paused" ? "paused" : "active",
    pausedByUserIds: relationship.payload.paused_by_user_ids as string[] ?? [],
    version: Number(relationship.payload.version ?? 1),
    createdAt: relationship.createdAt, updatedAt: relationship.updatedAt } satisfies FrogSleepBuddyDomainRelationshipRecord;
}

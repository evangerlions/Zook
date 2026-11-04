import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord } from "../../../shared/types.ts";
import { ApplicationError, conflict } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Resolves the authorized recipient without exposing invitations to another account. */
export async function invitationCommandIdentity(database: ApplicationDatabase, invitationId: string,
  actorUserId: string, domain: "sleep" | "focus", action: "accept" | "decline" | "cancel") {
  const bundle = await database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, invitationId);
  if (!bundle || !bundle.domains.includes(domain)) throw unavailable();
  if (action === "cancel") {
    if (bundle.inviterUserId !== actorUserId) throw unavailable();
    return bundle;
  }
  if (bundle.inviterUserId === actorUserId) throw unavailable();
  if (bundle.inviteeUserId === actorUserId) return bundle;
  if (bundle.inviteeUserId || !bundle.recipientEmail) throw unavailable();
  const user = await database.findUserById(actorUserId);
  if (user?.email?.trim().toLowerCase() !== bundle.recipientEmail.trim().toLowerCase()) throw unavailable();
  return { ...bundle, inviteeUserId: actorUserId };
}

export async function bindInvitationRecipient(database: ApplicationDatabase, bundle: FrogSleepBuddyInvitationBundleRecord) {
  const stored = await database.findFrogSleepBuddyInvitationBundle(bundle.appId, bundle.id);
  if (stored && !stored.inviteeUserId && bundle.inviteeUserId) {
    await database.upsertFrogSleepBuddyInvitationBundle({ ...stored, inviteeUserId: bundle.inviteeUserId });
  }
}

function unavailable() {
  return new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
}

/** Keeps compatibility invitation projections terminal without creating legacy relationships or grants. */
export async function consumeLegacyInvitation(database: ApplicationDatabase, bundle: FrogSleepBuddyInvitationBundleRecord,
  domain: "sleep" | "focus", status: "accepted" | "declined" | "cancelled") {
  const id = bundle.domainInvitationIds[domain];
  if (!id) return;
  const child = await database.findFrogSleepEntity(`${domain}_invite`, bundle.appId, id);
  if (!child || child.status !== "pending") return;
  await database.updateFrogSleepEntity(child.kind, bundle.appId, child.id, { status,
    payload: { ...child.payload, version: Number(child.payload.version ?? 1) + 1,
      domain_decision_invitation_id: bundle.id } });
}

export async function assertLegacyInvitationPending(database: ApplicationDatabase,
  bundle: FrogSleepBuddyInvitationBundleRecord, domain: "sleep" | "focus") {
  const id = bundle.domainInvitationIds[domain];
  if (!id) return;
  const child = await database.findFrogSleepEntity(`${domain}_invite`, bundle.appId, id);
  if (child && child.status !== "pending") conflict("REQ_INVALID_BODY", "Buddy invitation domain is already terminal.");
}

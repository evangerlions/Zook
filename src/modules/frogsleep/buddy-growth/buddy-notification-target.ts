import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityKind } from "../../../shared/types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { BuddyConsentService } from "./buddy-consent.service.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";
import { buddyRelationshipMute } from "./buddy-relationship-lifecycle.service.ts";

const targetKinds: Record<string, FrogSleepEntityKind> = {
  buddy_share: "buddy_share", buddy_interaction: "buddy_interaction", buddy_joint_activity: "buddy_joint_activity",
  buddy_goal: "buddy_joint_goal", buddy_joint_goal: "buddy_joint_goal", buddy_milestone: "buddy_milestone", buddy_weekly_report: "buddy_weekly_report",
};

type Target = { targetType: string; targetId: string; safeRoute: Record<string, unknown>; expiresAt?: string };

/** Re-authorizes notification identifiers against current target, membership, direction and relationship state. */
export async function authorizeBuddyNotificationTarget(database: ApplicationDatabase, viewer: string, target: Target, delivery = false) {
  if (target.expiresAt && Date.parse(target.expiresAt) <= Date.now()) throw unavailable();
  if (target.safeRoute.type !== target.targetType) throw unavailable();
  assertRouteIdentifier(target);
  if (target.targetType === "buddy_invitation") {
    await authorizeInvitation(database, viewer, target.targetId);
    return;
  }
  const kind = targetKinds[target.targetType];
  if (!kind) throw unavailable();
  const row = await database.findFrogSleepEntity(kind, FROGSLEEP_APP_ID, target.targetId);
  if (!row?.relationshipId || ![row.ownerUserId, row.partnerUserId].includes(viewer)
    || ["cancelled", "revoked", "expired"].includes(row.status ?? "")) throw unavailable();
  if (target.safeRoute.relationship_id !== row.relationshipId) throw unavailable();
  if (row.payload.expires_at && Date.parse(String(row.payload.expires_at)) <= Date.now()) throw unavailable();
  const category = target.targetType === "buddy_weekly_report" || row.payload.type === "weekly_progress" ? "weekly_trend"
    : target.targetType === "buddy_share" ? "daily_summary" : "shared_activity";
  await new BuddyConsentService(database).assertAuthorized(viewer, row.relationshipId, category);
  if (delivery && (await buddyRelationshipMute(database, viewer, row.relationshipId))?.payload.muted === true) throw unavailable();
}

async function authorizeInvitation(database: ApplicationDatabase, viewer: string, id: string) {
  const bundle = await database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, id);
  const invite = bundle ? undefined : await database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, id)
    ?? await database.findFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, id);
  const inviter = bundle?.inviterUserId ?? invite?.ownerUserId;
  const invitee = bundle?.inviteeUserId ?? invite?.partnerUserId;
  if (!inviter || ![inviter, invitee].includes(viewer)) throw unavailable();
  if (invitee) await assertBuddyPairNotBlocked(database, inviter, invitee);
  const status = bundle?.status ?? invite?.status;
  const expiresAt = bundle?.expiresAt ?? String(invite?.payload.expires_at ?? "");
  if (["expired", "revoked"].includes(status ?? "")
    || status === "pending" && expiresAt && Date.parse(expiresAt) <= Date.now()) throw unavailable();
}

function assertRouteIdentifier(target: Target) {
  const key = target.targetType === "buddy_invitation" ? "invitation_id"
    : target.targetType === "buddy_weekly_report" ? "report_id"
    : target.targetType === "buddy_milestone" ? "milestone_id"
    : ["buddy_goal", "buddy_joint_goal"].includes(target.targetType) ? "goal_id" : "interaction_id";
  // Previous growth events used interaction_id for every kind; accept only the same authoritative target id.
  if ((target.safeRoute[key] ?? target.safeRoute.interaction_id) !== target.targetId) throw unavailable();
  for (const field of ["invitation_id", "report_id", "milestone_id", "goal_id", "interaction_id"]) {
    if (target.safeRoute[field] === undefined) continue;
    const legacyKey = key !== "invitation_id" && field === "interaction_id";
    if (field !== key && !legacyKey || target.safeRoute[field] !== target.targetId) throw unavailable();
  }
}

function unavailable() { return new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy notification target is unavailable."); }

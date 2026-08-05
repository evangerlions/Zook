import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { toFocusRelationshipResponse } from "./focus-buddy-mappers.ts";
import { assertBuddyPairNotBlocked } from "../buddy-growth/buddy-safety.ts";
import { enqueueBuddyInvitationEvent } from "../buddy-growth/buddy-invitation-events.ts";
import { limitBuddyInviteCreation } from "../buddy-growth/buddy-rate-limit.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type FocusBuddyDeps = {
  database: ApplicationDatabase;
  notificationService?: NotificationService;
  kvManager?: KVManager;
};

function nowIso(): string {
  return new Date().toISOString();
}

function defaultInviteExpiresAt(createdAt: string): string {
  return new Date(new Date(createdAt).getTime() + INVITE_TTL_MS).toISOString();
}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function generateUniqueCode(database: ApplicationDatabase): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const existing = await database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, code);
    if (!existing) {
      return code;
    }
  }
  conflict("REQ_INVALID_BODY", "Could not allocate a unique focus invite code.");
}

export async function createFocusInvite(
  deps: FocusBuddyDeps,
  userId: string,
  target: string,
  focusInviteBaseUrl = "frogsleep://focus-invite",
  bundleId?: string,
) {
  if (deps.kvManager) {
    await limitBuddyInviteCreation(deps.kvManager, userId);
  }
  return await deps.database.withExclusiveSession(async () => {
    const targetUser = await resolveUser(deps.database, target);
    if (!targetUser || targetUser.id === userId) {
      badRequest("REQ_INVALID_BODY", "Target user is invalid.");
    }
    await assertNoFocusConflict(deps.database, userId, targetUser.id);
    const createdAt = nowIso();
    const code = await generateUniqueCode(deps.database);
    const token = randomId("focus_invite_token");
    const relationship: FrogSleepEntityRecord = {
      id: randomId("focus_relationship"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_relationship",
      ownerUserId: userId,
      partnerUserId: targetUser.id,
      status: "pending",
      payload: {},
      createdAt,
      updatedAt: createdAt,
    };
    await deps.database.insertFrogSleepEntity(relationship);
    const expiresAt = defaultInviteExpiresAt(createdAt);
    const invite: FrogSleepEntityRecord = {
      id: randomId("focus_invite"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_invite",
      ownerUserId: userId,
      partnerUserId: targetUser.id,
      relationshipId: relationship.id,
      status: "pending",
      code,
      token,
      payload: {
        shareLink: `${focusInviteBaseUrl}?mode=preview&token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
        shareTitle: "专注搭子邀请",
        shareSubtitle: "一起完成下一次专注",
        expires_at: expiresAt,
        bundle_id: bundleId,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await deps.database.insertFrogSleepEntity(invite);
    if (!bundleId) await enqueueBuddyInvitationEvent(deps.database, {
      recipientUserId: targetUser.id, invitationId: invite.id, domain: "focus", eventType: "invitation_created",
    });
    await queuePush(deps, targetUser.id, buildFrogSleepNotificationPayload({
      type: "focus_buddy_invite",
      entityId: invite.id,
      relationshipId: relationship.id,
    }));
    return toFocusRelationshipResponse(relationship, userId, invite);
  });
}

export async function acceptFocusInviteByCode(deps: FocusBuddyDeps, userId: string, code: string) {
  const invite = await deps.database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, code);
  return await acceptInvite(deps.database, userId, invite, "code");
}

export async function acceptFocusInviteByToken(deps: FocusBuddyDeps, userId: string, token: string) {
  const invite = await deps.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, token);
  return await acceptInvite(deps.database, userId, invite, "token");
}

export async function acceptFocusInviteById(deps: FocusBuddyDeps, userId: string, inviteId: string) {
  const invite = await deps.database.findFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, inviteId);
  return await acceptInvite(deps.database, userId, invite, "id");
}

export async function pendingFocusInvites(deps: FocusBuddyDeps, userId: string) {
  const [owned, received] = await Promise.all([
    deps.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_invite", ownerUserId: userId, status: "pending" }),
    deps.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_invite", partnerUserId: userId, status: "pending" }),
  ]);
  const refreshed = await Promise.all([...owned, ...received].map((invite) => refreshInviteStatus(deps.database, invite)));
  return { invites: refreshed.filter((invite) => invite.status === "pending").map((invite) => ({
    raw_invite_id: invite.id,
    relationship_id: invite.relationshipId,
    inviter_user_id: invite.ownerUserId,
    invitee_user_id: invite.partnerUserId,
    status: invite.status,
    invite_code: invite.code,
    invite_token: invite.token,
    expires_at: invite.payload.expires_at,
  })) };
}

export async function focusInviteAction(
  deps: FocusBuddyDeps,
  userId: string,
  inviteId: string,
  action: "decline" | "cancel",
) {
  return deps.database.withExclusiveSession(async () => {
    const invite = await deps.database.findFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, inviteId);
    if (!invite || invite.status !== "pending" || !invite.relationshipId) badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    if (action === "cancel" && invite.ownerUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the inviter can cancel this invite.");
    if (action === "decline" && invite.partnerUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can decline this invite.");
    if (invite.ownerUserId && invite.partnerUserId) await assertBuddyPairNotBlocked(deps.database, invite.ownerUserId, invite.partnerUserId);
    const status = action === "cancel" ? "cancelled" : "declined";
    const updated = await deps.database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, invite.id, { status });
    await deps.database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, invite.relationshipId, { status });
    return { raw_invite_id: updated?.id, relationship_id: invite.relationshipId, status };
  });
}

export async function trackFocusInviteOpenByToken(deps: FocusBuddyDeps, token: string, userAgent?: string) {
  const invite = await deps.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, token.trim());
  if (!invite) {
    return;
  }
  await markInviteOpened(deps.database, invite, userAgent);
}

export async function previewFocusInvite(
  deps: FocusBuddyDeps,
  userId: string,
  input: { token?: string; code?: string },
) {
  const invite = input.token
    ? await deps.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, input.token.trim())
    : input.code
      ? await deps.database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, input.code.trim())
      : undefined;
  const currentInvite = invite ? await refreshInviteStatus(deps.database, invite) : undefined;
  if (!currentInvite) {
    badRequest("REQ_INVALID_BODY", "Invite not found.");
  }
  const relationship = currentInvite.relationshipId
    ? await deps.database.findFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, currentInvite.relationshipId)
    : undefined;
  return {
    invite: {
      domain: "focus",
      invite_id: relationship?.id ?? currentInvite.id,
      raw_invite_id: currentInvite.id,
      status: currentInvite.status,
      inviter_user_id: currentInvite.ownerUserId,
      invitee_user_id: currentInvite.partnerUserId,
      viewer_can_accept: currentInvite.status === "pending" && currentInvite.partnerUserId === userId,
      accept_method: input.token ? "token" : "code",
      expires_at: currentInvite.payload.expires_at ?? currentInvite.payload.expiresAt,
      share_title: currentInvite.payload.shareTitle,
      share_subtitle: currentInvite.payload.shareSubtitle,
    },
  };
}

export async function recordFocusMatchFeedback(
  deps: FocusBuddyDeps,
  userId: string,
  targetUserId: string,
  action: "dismissed" | "reported",
  input: Record<string, unknown>,
) {
  if (userId === targetUserId) {
    badRequest("REQ_INVALID_BODY", "Cannot record feedback for yourself.");
  }
  const createdAt = nowIso();
  const record: FrogSleepEntityRecord = {
    id: randomId("focus_match_feedback"),
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: userId,
    partnerUserId: targetUserId,
    status: action,
    payload: {
      reason: input.reason,
      note: input.note,
    },
    createdAt,
    updatedAt: createdAt,
  };
  await deps.database.insertFrogSleepEntity(record);
  return {
    id: record.id,
    target_user_id: targetUserId,
    status: action,
    reason: record.payload.reason,
    created_at: record.createdAt,
  };
}

export async function excludedFocusMatchUserIds(
  database: ApplicationDatabase,
  userId: string,
  candidateUserIds: string[],
) {
  const candidates = new Set(candidateUserIds);
  const excluded = new Set<string>();
  const feedback = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: userId,
    limit: 500,
  });
  for (const item of feedback) {
    if (
      item.partnerUserId &&
      candidates.has(item.partnerUserId) &&
      (item.status === "dismissed" || item.status === "reported")
    ) {
      excluded.add(item.partnerUserId);
    }
  }
  return excluded;
}

export async function refreshFocusInviteRelationships(
  database: ApplicationDatabase,
  relationships: FrogSleepEntityRecord[],
) {
  const refreshed: FrogSleepEntityRecord[] = [];
  for (const relationship of relationships) {
    if (relationship.status !== "pending") {
      refreshed.push(relationship);
      continue;
    }
    const invites = await database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      kind: "focus_invite",
      relationshipId: relationship.id,
      limit: 1,
    });
    const invite = invites[0];
    if (!invite) {
      refreshed.push(relationship);
      continue;
    }
    const currentInvite = await refreshInviteStatus(database, invite);
    if (currentInvite.status !== "expired") {
      refreshed.push(relationship);
      continue;
    }
    const currentRelationship = await database.findFrogSleepEntity(
      "focus_relationship",
      FROGSLEEP_APP_ID,
      relationship.id,
    );
    refreshed.push(currentRelationship ?? { ...relationship, status: "expired" });
  }
  return refreshed;
}

async function acceptInvite(
  database: ApplicationDatabase,
  userId: string,
  invite: FrogSleepEntityRecord | undefined,
  source: string,
) {
  return await database.withExclusiveSession(async () => {
    const currentInvite = invite ? await refreshInviteStatus(database, invite) : undefined;
    if (currentInvite?.status === "expired") {
      badRequest("REQ_INVALID_BODY", "Invite has expired.");
    }
    if (!currentInvite || currentInvite.status !== "pending" || !currentInvite.relationshipId) {
      badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    }
    if (currentInvite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "This invite is not for the current user.");
    }
    await assertBuddyPairNotBlocked(database, currentInvite.ownerUserId as string, userId);
    const acceptedAt = nowIso();
    const currentRelationship = await database.findFrogSleepEntity(
      "focus_relationship",
      FROGSLEEP_APP_ID,
      currentInvite.relationshipId,
    );
    if (!currentRelationship || currentRelationship.status !== "pending") {
      badRequest("REQ_INVALID_BODY", "Pending relationship not found.");
    }
    const relationship = await database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, currentInvite.relationshipId, {
      status: "accepted",
      payload: {
        ...currentRelationship.payload,
        source_invite_id: currentInvite.id,
        accept_source: source,
        accepted_at: acceptedAt,
      },
    });
    const acceptedInvite = await database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, currentInvite.id, {
      status: "accepted",
      payload: {
        ...currentInvite.payload,
        accepted_at: acceptedAt,
        accepted_by_user_id: userId,
        accept_source: source,
      },
    });
    return toFocusRelationshipResponse(relationship as FrogSleepEntityRecord, userId, acceptedInvite as FrogSleepEntityRecord);
  });
}

async function markInviteOpened(database: ApplicationDatabase, invite: FrogSleepEntityRecord, userAgent?: string) {
  const openedAt = nowIso();
  const payload = invite.payload ?? {};
  await database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, invite.id, {
    payload: {
      ...payload,
      first_opened_at: payload.first_opened_at ?? openedAt,
      last_opened_at: openedAt,
      open_count: Number(payload.open_count ?? 0) + 1,
      last_open_source: "redirect",
      last_open_user_agent: userAgent,
    },
  });
}

async function refreshInviteStatus(database: ApplicationDatabase, invite: FrogSleepEntityRecord) {
  if (invite.status !== "pending" || !isInviteExpired(invite)) {
    return invite;
  }
  if (invite.relationshipId) {
    await database.updateFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, invite.relationshipId, {
      status: "expired",
    });
  }
  return await database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, invite.id, {
    status: "expired",
  }) as FrogSleepEntityRecord;
}

function isInviteExpired(invite: FrogSleepEntityRecord): boolean {
  const expiresAt = invite.payload.expires_at ?? invite.payload.expiresAt;
  return typeof expiresAt === "string" && new Date(expiresAt).getTime() <= Date.now();
}

async function resolveUser(database: ApplicationDatabase, value: string) {
  if (value.includes("@")) {
    return await database.findUserByAccount(value);
  }
  return await database.findUserById(value);
}

async function assertNoFocusConflict(database: ApplicationDatabase, userA: string, userB: string) {
  const relationships = await relationshipsForUser(database, userA, ["pending", "accepted"]);
  if (relationships.some((item) => otherUserId(item, userA) === userB)) {
    conflict("REQ_INVALID_BODY", "A focus buddy relationship already exists.");
  }
}

async function relationshipsForUser(database: ApplicationDatabase, userId: string, statuses: string[]) {
  const owned = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_relationship",
    ownerUserId: userId,
    limit: 100,
  });
  const partnered = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_relationship",
    partnerUserId: userId,
    limit: 100,
  });
  return [...owned, ...partnered].filter((item) => item.status && statuses.includes(item.status));
}

async function queuePush(deps: FocusBuddyDeps, userId: string, payload: Record<string, unknown>) {
  if (!deps.notificationService) {
    return;
  }
  await deps.notificationService.queueNotification({
    appId: FROGSLEEP_APP_ID,
    recipientUserId: userId,
    channel: "push",
    payload,
  });
}

function otherUserId(record: FrogSleepEntityRecord, userId: string): string {
  return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
}

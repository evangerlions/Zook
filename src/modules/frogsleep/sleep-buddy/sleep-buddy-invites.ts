import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { NotificationService } from "../../../services/notification.service.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { buildFrogSleepNotificationPayload } from "../frogsleep-notifications.ts";
import { assertBuddyPairNotBlocked } from "../buddy-growth/buddy-safety.ts";
import { enqueueBuddyInvitationEvent } from "../buddy-growth/buddy-invitation-events.ts";
import { limitBuddyInviteCreation } from "../buddy-growth/buddy-rate-limit.ts";
import {
  toSleepInviteResponse,
  toSleepRelationshipResponse,
} from "./sleep-buddy-mappers.ts";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SleepBuddyDeps = {
  database: ApplicationDatabase;
  notificationService?: NotificationService;
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
    const existing = await database.findFrogSleepEntityByCode("sleep_invite", FROGSLEEP_APP_ID, code);
    if (!existing) {
      return code;
    }
  }
  conflict("REQ_INVALID_BODY", "Could not allocate a unique sleep invite code.");
}

function asPayload(record?: FrogSleepEntityRecord): Record<string, unknown> {
  return record?.payload ?? {};
}

function normalizeEmail(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized?.includes("@") ? normalized : undefined;
}

export async function createSleepInvite(
  deps: SleepBuddyDeps,
  command: {
    userId: string;
    invitee: string;
    role?: string;
    customLabel?: string;
    sleepInviteBaseUrl?: string;
    bundleId?: string;
  },
) {
  limitBuddyInviteCreation(command.userId);
  return await deps.database.withExclusiveSession(async () => {
    const invitee = command.invitee.trim();
    if (!invitee) {
      badRequest("REQ_INVALID_BODY", "invitee is required.");
    }

    const inviteeEmailSnapshot = normalizeEmail(invitee);
    const target = await resolveUser(deps.database, invitee);
    if (target?.id === command.userId) {
      badRequest("REQ_INVALID_BODY", "Cannot invite yourself.");
    }
    if (target) {
      await assertNoConflict(deps.database, command.userId, target.id);
    }

    const createdAt = nowIso();
    const code = await generateUniqueCode(deps.database);
    const token = randomId("sleep_invite_token");
    const link = `${command.sleepInviteBaseUrl ?? "frogsleep://sleep-buddy-invite"}?mode=preview&token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`;
    const expiresAt = defaultInviteExpiresAt(createdAt);
    const invite: FrogSleepEntityRecord = {
      id: randomId("sleep_invite"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_invite",
      ownerUserId: command.userId,
      partnerUserId: target?.id,
      status: "pending",
      code,
      token,
      payload: {
        invitee,
        inviteeEmailSnapshot: inviteeEmailSnapshot ?? normalizeEmail(target?.email),
        role: command.role ?? "guardian",
        customLabel: command.customLabel,
        shareLink: link,
        shareTitle: "睡眠搭子邀请",
        shareSubtitle: "一起守住今晚的睡眠节奏",
        expires_at: expiresAt,
        bundle_id: command.bundleId,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await deps.database.insertFrogSleepEntity(invite);
    if (!command.bundleId) await enqueueBuddyInvitationEvent(deps.database, {
      recipientUserId: target?.id, invitationId: invite.id, domain: "sleep", eventType: "invitation_created",
    });
    if (target?.id) {
      await queuePush(deps, target.id, buildFrogSleepNotificationPayload({
        type: "sleep_buddy_invite",
        entityId: invite.id,
      }));
    }
    return toSleepInviteResponse(invite);
  });
}

export async function pendingSleepInvites(deps: SleepBuddyDeps, userId: string) {
  const owned = await deps.database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "sleep_invite",
    ownerUserId: userId,
    status: "pending",
  });
  const received = await deps.database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "sleep_invite",
    partnerUserId: userId,
    status: "pending",
  });
  const invites = await Promise.all([...owned, ...received].map((invite) => refreshInviteStatus(deps.database, invite)));
  return invites
    .filter((invite) => invite.status === "pending")
    .map((invite) => toSleepInviteResponse(invite));
}

export async function acceptSleepInviteByCode(deps: SleepBuddyDeps, userId: string, code: string) {
  const invite = await deps.database.findFrogSleepEntityByCode("sleep_invite", FROGSLEEP_APP_ID, code.trim());
  return await acceptInvite(deps.database, userId, invite, "code");
}

export async function acceptSleepInviteByToken(deps: SleepBuddyDeps, userId: string, token: string) {
  const invite = await deps.database.findFrogSleepEntityByToken("sleep_invite", FROGSLEEP_APP_ID, token.trim());
  return await acceptInvite(deps.database, userId, invite, "token");
}

export async function acceptSleepInviteById(deps: SleepBuddyDeps, userId: string, inviteId: string) {
  const invite = await deps.database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, inviteId);
  return await acceptInvite(deps.database, userId, invite, "id");
}

export async function sleepInviteAction(
  deps: SleepBuddyDeps,
  userId: string,
  inviteId: string,
  action: "decline" | "cancel",
) {
  return await deps.database.withExclusiveSession(async () => {
    const invite = await deps.database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, inviteId);
    if (!invite || invite.status !== "pending") {
      badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    }
    if (action === "cancel" && invite.ownerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the inviter can cancel this invite.");
    }
    if (action === "decline") {
      await assertCanDeclineInvite(deps.database, invite, userId);
    }
    if (invite.ownerUserId && invite.partnerUserId) {
      await assertBuddyPairNotBlocked(deps.database, invite.ownerUserId, invite.partnerUserId);
    }
    const updated = await deps.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, inviteId, {
      status: action === "cancel" ? "cancelled" : "declined",
    });
    return toSleepInviteResponse(updated as FrogSleepEntityRecord);
  });
}

export async function trackSleepInviteOpenByToken(deps: SleepBuddyDeps, token: string, userAgent?: string) {
  const invite = await deps.database.findFrogSleepEntityByToken("sleep_invite", FROGSLEEP_APP_ID, token.trim());
  if (!invite) {
    return;
  }
  await markInviteOpened(deps.database, invite, userAgent);
}

export async function previewSleepInvite(
  deps: SleepBuddyDeps,
  userId: string,
  input: { token?: string; code?: string },
) {
  const invite = input.token
    ? await deps.database.findFrogSleepEntityByToken("sleep_invite", FROGSLEEP_APP_ID, input.token.trim())
    : input.code
      ? await deps.database.findFrogSleepEntityByCode("sleep_invite", FROGSLEEP_APP_ID, input.code.trim())
      : undefined;
  const currentInvite = invite ? await refreshInviteStatus(deps.database, invite) : undefined;
  if (!currentInvite) {
    badRequest("REQ_INVALID_BODY", "Invite not found.");
  }
  const viewerCanAccept = currentInvite.status === "pending" &&
    await canUserAcceptInvitePreview(deps.database, currentInvite, userId);
  const relationship = currentInvite.relationshipId
    ? await deps.database.findFrogSleepEntity("sleep_relationship", FROGSLEEP_APP_ID, currentInvite.relationshipId)
    : undefined;
  return {
    invite: {
      domain: "sleep",
      invite_id: relationship?.id ?? currentInvite.id,
      raw_invite_id: currentInvite.id,
      status: currentInvite.status,
      inviter_user_id: currentInvite.ownerUserId,
      invitee_user_id: currentInvite.partnerUserId,
      viewer_can_accept: viewerCanAccept,
      accept_method: input.token ? "token" : "code",
      expires_at: currentInvite.payload.expires_at ?? currentInvite.payload.expiresAt,
      share_title: currentInvite.payload.shareTitle,
      share_subtitle: currentInvite.payload.shareSubtitle,
    },
  };
}

async function markInviteOpened(database: ApplicationDatabase, invite: FrogSleepEntityRecord, userAgent?: string) {
  const openedAt = nowIso();
  const payload = invite.payload ?? {};
  await database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, invite.id, {
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
    if (!currentInvite || currentInvite.status !== "pending") {
      badRequest("REQ_INVALID_BODY", "Pending invite not found.");
    }
    if (currentInvite.ownerUserId === userId) {
      badRequest("REQ_INVALID_BODY", "Cannot accept your own invite.");
    }
    if (currentInvite.partnerUserId && currentInvite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "This invite is not for the current user.");
    }
    await assertInviteEmailOwner(database, currentInvite, userId);
    await assertBuddyPairNotBlocked(database, currentInvite.ownerUserId as string, userId);

    await assertNoConflict(database, currentInvite.ownerUserId as string, userId);
    const createdAt = nowIso();
    const acceptedAt = nowIso();
    const relationship: FrogSleepEntityRecord = {
      id: randomId("sleep_relationship"),
      appId: FROGSLEEP_APP_ID,
      kind: "sleep_relationship",
      ownerUserId: currentInvite.ownerUserId,
      partnerUserId: userId,
      status: "active",
      payload: {
        inviteId: currentInvite.id,
        source_invite_id: currentInvite.id,
        accept_source: source,
        accepted_at: acceptedAt,
      },
      createdAt,
      updatedAt: createdAt,
    };
    await database.insertFrogSleepEntity(relationship);
    await database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, currentInvite.id, {
      status: "accepted",
      partnerUserId: userId,
      relationshipId: relationship.id,
      payload: {
        ...currentInvite.payload,
        accepted_at: acceptedAt,
        accepted_by_user_id: userId,
        accept_source: source,
      },
    });
    await createDefaultPreference(database, relationship.id, relationship.ownerUserId as string);
    await createDefaultPreference(database, relationship.id, userId);
    return toSleepRelationshipResponse(relationship, userId);
  });
}

async function canUserAcceptInvitePreview(database: ApplicationDatabase, invite: FrogSleepEntityRecord, userId: string) {
  if (invite.ownerUserId === userId) {
    return false;
  }
  if (invite.partnerUserId === userId) {
    return true;
  }
  if (invite.partnerUserId) {
    return false;
  }
  const payload = asPayload(invite);
  const inviteeEmailSnapshot = normalizeEmail(
    typeof payload.inviteeEmailSnapshot === "string"
      ? payload.inviteeEmailSnapshot
      : typeof payload.invitee_email_snapshot === "string"
        ? payload.invitee_email_snapshot
        : undefined,
  );
  if (!inviteeEmailSnapshot) {
    return true;
  }
  const user = await database.findUserById(userId);
  return normalizeEmail(user?.email) === inviteeEmailSnapshot;
}

async function refreshInviteStatus(database: ApplicationDatabase, invite: FrogSleepEntityRecord) {
  if (invite.status !== "pending" || !isInviteExpired(invite)) {
    return invite;
  }
  return await database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, invite.id, {
    status: "expired",
  }) as FrogSleepEntityRecord;
}

function isInviteExpired(invite: FrogSleepEntityRecord): boolean {
  const expiresAt = asPayload(invite).expires_at ?? asPayload(invite).expiresAt;
  return typeof expiresAt === "string" && new Date(expiresAt).getTime() <= Date.now();
}

async function assertNoConflict(database: ApplicationDatabase, userA: string, userB: string) {
  const relationships = await relationshipsForUser(database, userA, ["active", "paused"]);
  if (relationships.some((item) => otherUserId(item, userA) === userB)) {
    conflict("REQ_INVALID_BODY", "A sleep buddy relationship already exists.");
  }
}

async function resolveUser(database: ApplicationDatabase, value: string) {
  if (value.includes("@")) {
    return await database.findUserByAccount(value);
  }
  return await database.findUserById(value);
}

async function assertInviteEmailOwner(database: ApplicationDatabase, invite: FrogSleepEntityRecord, userId: string) {
  const payload = asPayload(invite);
  const inviteeEmailSnapshot = normalizeEmail(
    typeof payload.inviteeEmailSnapshot === "string"
      ? payload.inviteeEmailSnapshot
      : typeof payload.invitee_email_snapshot === "string"
        ? payload.invitee_email_snapshot
        : undefined,
  );
  if (!inviteeEmailSnapshot) {
    return;
  }
  const user = await database.findUserById(userId);
  if (normalizeEmail(user?.email) !== inviteeEmailSnapshot) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "This invite is not for the current verified email.");
  }
}

async function assertCanDeclineInvite(database: ApplicationDatabase, invite: FrogSleepEntityRecord, userId: string) {
  if (invite.ownerUserId === userId) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Inviter must cancel this invite instead of declining it.");
  }
  if (invite.partnerUserId) {
    if (invite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can decline this invite.");
    }
    return;
  }
  const payload = asPayload(invite);
  const inviteeEmailSnapshot = normalizeEmail(
    typeof payload.inviteeEmailSnapshot === "string"
      ? payload.inviteeEmailSnapshot
      : typeof payload.invitee_email_snapshot === "string"
        ? payload.invitee_email_snapshot
        : undefined,
  );
  if (!inviteeEmailSnapshot) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Only an authorized invitee can decline this invite.");
  }
  const user = await database.findUserById(userId);
  if (normalizeEmail(user?.email) !== inviteeEmailSnapshot) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can decline this invite.");
  }
}

async function relationshipsForUser(database: ApplicationDatabase, userId: string, statuses: string[]) {
  const owned = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "sleep_relationship",
    ownerUserId: userId,
    limit: 100,
  });
  const partnered = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "sleep_relationship",
    partnerUserId: userId,
    limit: 100,
  });
  return [...owned, ...partnered].filter((item) => item.status && statuses.includes(item.status));
}

async function queuePush(deps: SleepBuddyDeps, userId: string, payload: Record<string, unknown>) {
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

function defaultPreferences() {
  return {
    guard_level: "standard",
    visibility_scope: "summary",
    mute_for_tonight: false,
    allow_morning_summary_push: true,
    allow_recovery_nudges: true,
  };
}

async function createDefaultPreference(database: ApplicationDatabase, relationshipId: string, userId: string) {
  const createdAt = nowIso();
  await database.insertFrogSleepEntity({
    id: randomId("sleep_pref"),
    appId: FROGSLEEP_APP_ID,
    kind: "guardianship_preference",
    ownerUserId: userId,
    relationshipId,
    payload: defaultPreferences(),
    createdAt,
    updatedAt: createdAt,
  });
}

function otherUserId(record: FrogSleepEntityRecord, userId: string): string {
  return record.ownerUserId === userId ? (record.partnerUserId as string) : (record.ownerUserId as string);
}

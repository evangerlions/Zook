import { createHash, randomBytes } from "node:crypto";
import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type { BodyLogInvitationAttributionRecord } from "./bodylog-invitation.types.ts";

const DAY_MS = 86_400_000;

export class BodyLogInvitationService {
  constructor(private readonly database: ApplicationDatabase) {}

  async create(inviterUserId: string, installId: unknown) {
    if (typeof installId !== "string" || installId.trim().length < 8) {
      throw new ApplicationError(400, "BODYLOG_INVITATION_INVALID", "Installation identifier is required.");
    }
    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * DAY_MS);
    const record = {
      id: randomId("bodylog_invitation"), appId: BODYLOG_APP_ID,
      inviterUserId, inviterInstallIdHash: hash(installId), tokenHash: hash(token),
      expiresAt: expiresAt.toISOString(), createdAt: now.toISOString(),
    };
    await this.database.insertBodyLogInvitation(record);
    return {
      token, url: `https://bodylog.app/i/${token}`,
      expiresAt: record.expiresAt,
    };
  }

  async list(userId: string) {
    const invitations = await this.database.listBodyLogInvitations(BODYLOG_APP_ID, userId);
    const invitationIds = new Set(invitations.map((item) => item.id));
    const all = await this.database.listBodyLogInvitationAttributions(BODYLOG_APP_ID);
    const invited = all.filter((item) => invitationIds.has(item.invitationId));
    const ownAttribution = all.find((item) => item.inviteeUserId === userId);
    const rewardEnds = all.flatMap((item) => [
      item.inviterUserId === userId ? item.inviterRewardEndsAt : undefined,
      item.inviteeUserId === userId ? item.inviteeRewardEndsAt : undefined,
    ]).filter((value): value is string => Boolean(value)).sort();
    return {
      pendingCount: invited.filter((item) => !item.qualifiedAt).length,
      qualifiedCount: invited.filter((item) => Boolean(item.qualifiedAt)).length,
      rewardedCount: invited.filter((item) => Boolean(item.inviterRewardEndsAt)).length,
      inviteeProgressDays: ownAttribution?.completedDates.length ?? 0,
      attributed: Boolean(ownAttribution),
      premiumUntil: rewardEnds.at(-1) ?? null,
      invitations: invited.map((item) => ({
        id: item.id,
        status: item.rewardedAt ? "rewarded" : item.qualifiedAt ? "qualified" : "pending",
        progressDays: item.completedDates.length,
        attributedAt: item.attributedAt,
      })),
    };
  }

  async attribute(inviteeUserId: string, input: { token: unknown; installId: unknown }) {
    if (typeof input.token !== "string" || typeof input.installId !== "string" ||
        input.installId.trim().length < 8) {
      throw new ApplicationError(400, "BODYLOG_INVITATION_INVALID", "Invitation is invalid.");
    }
    const invitation = await this.database.findBodyLogInvitationByTokenHash(
      BODYLOG_APP_ID, hash(input.token),
    );
    if (!invitation || Date.parse(invitation.expiresAt) <= Date.now()) {
      throw new ApplicationError(410, "BODYLOG_INVITATION_EXPIRED", "Invitation expired.");
    }
    if (invitation.inviterUserId === inviteeUserId) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "Self invitation is not allowed.");
    }
    const all = await this.database.listBodyLogInvitationAttributions(BODYLOG_APP_ID);
    const installIdHash = hash(input.installId);
    if (invitation.inviterInstallIdHash === installIdHash) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "Same-device invitation is not allowed.");
    }
    if (all.some((item) => item.inviteeUserId === inviteeUserId ||
        item.installIdHash === installIdHash)) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_ALREADY_ATTRIBUTED", "Invitation already attributed.");
    }
    const blocks = await this.database.listBodyLogBlocks(BODYLOG_APP_ID);
    if (blocks.some((item) =>
      (item.blockerUserId === inviteeUserId && item.blockedUserId === invitation.inviterUserId) ||
      (item.blockerUserId === invitation.inviterUserId && item.blockedUserId === inviteeUserId))) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "Invitation is unavailable.");
    }
    const record: BodyLogInvitationAttributionRecord = {
      id: randomId("bodylog_invitation_attribution"), appId: BODYLOG_APP_ID,
      invitationId: invitation.id, inviterUserId: invitation.inviterUserId,
      inviteeUserId, installIdHash, completedDates: [],
      attributedAt: new Date().toISOString(),
    };
    await this.database.insertBodyLogInvitationAttribution(record);
    return { attributed: true, progressDays: 0 };
  }

  async recordProgress(
    inviteeUserId: string,
    input: { date: unknown; timezone: unknown },
  ) {
    if (typeof input.date !== "string" || typeof input.timezone !== "string" ||
        input.date !== todayIn(input.timezone)) {
      throw new ApplicationError(400, "BODYLOG_INVITATION_PROGRESS_INVALID", "Only today's completed plan day is accepted.");
    }
    const all = await this.database.listBodyLogInvitationAttributions(BODYLOG_APP_ID);
    const current = all.find((item) => item.inviteeUserId === inviteeUserId);
    if (!current) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "No attributed invitation.");
    }
    if (current.completedDates.includes(input.date)) {
      return { progressDays: current.completedDates.length, qualified: Boolean(current.qualifiedAt) };
    }
    const updated: BodyLogInvitationAttributionRecord = {
      ...current,
      completedDates: [...current.completedDates, input.date].sort(),
    };
    if (updated.completedDates.length >= 3 && !updated.qualifiedAt) {
      const now = new Date();
      updated.qualifiedAt = now.toISOString();
      updated.rewardedAt = now.toISOString();
      updated.inviteeRewardEndsAt = nextRewardEnd(inviteeUserId, all, now);
      const inviterMonthRewards = all.filter((item) =>
        item.inviterUserId === updated.inviterUserId && item.rewardedAt &&
        sameCalendarMonth(new Date(item.rewardedAt), now)).length;
      if (inviterMonthRewards < 3) {
        updated.inviterRewardEndsAt = nextRewardEnd(updated.inviterUserId, all, now);
      }
    }
    await this.database.updateBodyLogInvitationAttribution(updated);
    return {
      progressDays: updated.completedDates.length,
      qualified: Boolean(updated.qualifiedAt),
      premiumUntil: updated.inviteeRewardEndsAt ?? null,
    };
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    throw new ApplicationError(400, "BODYLOG_INVITATION_PROGRESS_INVALID", "Time zone is invalid.");
  }
}

function nextRewardEnd(
  userId: string,
  all: BodyLogInvitationAttributionRecord[],
  now: Date,
): string {
  const existingEnds = all.flatMap((item) => [
    item.inviterUserId === userId ? item.inviterRewardEndsAt : undefined,
    item.inviteeUserId === userId ? item.inviteeRewardEndsAt : undefined,
  ]).filter((value): value is string => Boolean(value)).map(Date.parse);
  const start = Math.max(now.getTime(), ...existingEnds);
  return new Date(start + DAY_MS).toISOString();
}

function sameCalendarMonth(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth();
}

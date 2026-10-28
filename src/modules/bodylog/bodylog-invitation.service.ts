import type { BodyLogGrowthStore } from "../../infrastructure/bodylog-store-ports.ts";
import type { BodyLogRewardLedger } from "./bodylog-reward-ledger.ts";
import { createHash, randomBytes } from "node:crypto";
import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import type { BodyLogInvitationAttributionRecord, BodyLogInvitationRecord } from "./bodylog-invitation.types.ts";

const DAY_MS = 86_400_000;

export class BodyLogInvitationService {
  constructor(private readonly database: ApplicationDatabase, private readonly growth?: BodyLogGrowthStore, private readonly ledger?: BodyLogRewardLedger) {}

  async create(inviterUserId: string, installId: unknown, intent?: "general" | "buddy" | "group") {
    if (typeof installId !== "string" || installId.trim().length < 8) {
      throw new ApplicationError(400, "BODYLOG_INVITATION_INVALID", "Installation identifier is required.");
    }
    const token = randomBytes(24).toString("base64url");
    const code = await this.generateUniqueInviteCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * DAY_MS);
    const record = {
      id: randomId("bodylog_invitation"), appId: BODYLOG_APP_ID,
      inviterUserId, inviterInstallIdHash: hash(installId), tokenHash: hash(token),
      code,
      intent: intent ?? "general",
      expiresAt: expiresAt.toISOString(), createdAt: now.toISOString(),
    };
    await this.database.insertBodyLogInvitation(record);

    // 根据intent生成不同的URL路径
    const urlPath = "i";
    return {
      token,
      code,
      url: `https://bodylog.app/${urlPath}/${token}`,
      expiresAt: record.expiresAt,
    };
  }
  async list(userId: string) {
    await this.reconcile(userId);
    const invitations = await this.database.listBodyLogInvitations(BODYLOG_APP_ID, userId);
    const invitationById = new Map(invitations.map((item) => [item.id, item]));
    const all = await this.database.listBodyLogInvitationAttributions(BODYLOG_APP_ID);
    const invited = all.filter((item) => invitationById.has(item.invitationId));
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
      invitations: invited.map((item) => {
        const original = invitationById.get(item.invitationId);
        return {
          id: item.id,
          code: original?.code ?? null,
          status: item.rewardedAt ? "rewarded" : item.qualifiedAt ? "qualified" : "pending",
          progressDays: item.completedDates.length,
          attributedAt: item.attributedAt,
        };
      }),
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
    if (!invitation) {
      throw new ApplicationError(410, "BODYLOG_INVITATION_EXPIRED", "Invitation expired.");
    }
    return this.validateAndBind(inviteeUserId, invitation, input.installId);
  }

  async attributeByCode(inviteeUserId: string, input: { code: unknown; installId: unknown }) {
    if (typeof input.code !== "string" || input.code.length !== 6 ||
        typeof input.installId !== "string" || input.installId.trim().length < 8) {
      throw new ApplicationError(400, "BODYLOG_INVITATION_INVALID", "Invitation code is invalid.");
    }
    const invitation = await this.database.findBodyLogInvitationByCode(
      BODYLOG_APP_ID, input.code.toUpperCase(),
    );
    if (!invitation) {
      throw new ApplicationError(410, "BODYLOG_INVITATION_EXPIRED", "Invitation expired.");
    }
    return this.validateAndBind(inviteeUserId, invitation, input.installId);
  }

  async preview(input: { token?: unknown; code?: unknown }) {
    if ((input.token === undefined) === (input.code === undefined) ||
      (input.token !== undefined && (typeof input.token !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(input.token))) ||
      (input.code !== undefined && (typeof input.code !== "string" || !/^[A-Z2-9]{6}$/i.test(input.code)))) {
      throw new ApplicationError(400, "BODYLOG_INVITATION_INVALID", "Provide exactly one valid invitation token or code.");
    }
    const invitation = input.token !== undefined
      ? await this.database.findBodyLogInvitationByTokenHash(BODYLOG_APP_ID, hash(input.token as string))
      : await this.database.findBodyLogInvitationByCode(BODYLOG_APP_ID, (input.code as string).toUpperCase());
    if (!invitation || invitation.revokedAt || Date.parse(invitation.expiresAt) <= Date.now()) {
      throw new ApplicationError(410, "BODYLOG_INVITATION_EXPIRED", "Invitation is unavailable.");
    }
    return { intent: invitation.intent, code: invitation.code ?? null, expiresAt: invitation.expiresAt };
  }

  async revoke(userId: string, token: string) {
    const invitation = await this.database.findBodyLogInvitationByTokenHash(BODYLOG_APP_ID, hash(token));
    if (!invitation || invitation.inviterUserId !== userId) throw new ApplicationError(404, "BODYLOG_INVITATION_NOT_FOUND", "Invitation not found.");
    if (!invitation.revokedAt) await this.database.updateBodyLogInvitation({ ...invitation, revokedAt: new Date().toISOString() });
    return { revoked: true };
  }

  private async validateAndBind(
    inviteeUserId: string,
    invitation: BodyLogInvitationRecord,
    installId: string,
  ) {
    if (invitation.inviterUserId === inviteeUserId) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "Self invitation is not allowed.");
    }
    const all = await this.database.listBodyLogInvitationAttributions(BODYLOG_APP_ID);
    const installIdHash = hash(installId);
    if (invitation.inviterInstallIdHash === installIdHash) {
      throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "Same-device invitation is not allowed.");
    }
    const existing = all.find(item => item.inviteeUserId === inviteeUserId);
    if (existing?.invitationId === invitation.id && existing.installIdHash === installIdHash) {
      return { attributed: true, progressDays: existing.completedDates.length };
    }
    if (invitation.revokedAt || Date.parse(invitation.expiresAt) <= Date.now()) {
      throw new ApplicationError(410, "BODYLOG_INVITATION_EXPIRED", "Invitation is unavailable.");
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
    const record = await this.reconcile(inviteeUserId);
    if (!record) throw new ApplicationError(409, "BODYLOG_INVITATION_INVALID", "No attributed invitation.");
    if (record.completedDates.length === 0) throw new ApplicationError(409, "BODYLOG_INVITATION_PROGRESS_INVALID", "A recorded qualifying plan goal is required.");
    return { progressDays: record.completedDates.length, qualified: Boolean(record.qualifiedAt), premiumUntil: record.inviteeRewardEndsAt ?? null };
  }

  private async reconcile(userId: string) {
    const all = await this.database.listBodyLogInvitationAttributions(BODYLOG_APP_ID);
    const current = all.find(item => item.inviteeUserId === userId);
    if (!current || current.qualifiedAt || !this.growth) return current;
    const plan = await this.growth.findLatestGrowthPlan(userId);
    let dates: string[] = [];
    if (plan && plan.status !== "cancelled") {
      const zone = plan.timeZone ?? "UTC";
      const format = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      const start = format(new Date(plan.startDate));
      const attributed = format(new Date(current.attributedAt));
      dates = (await this.growth.findGrowthMissionsByPlanId(plan.id)).filter(item => item.type === "localGoal" && item.completed).map(item => {
        const date = new Date(`${start}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + item.day - 1);
        return date.toISOString().slice(0, 10);
      }).filter(date => date >= attributed && date <= format(new Date()));
    }
    const updated = { ...current, completedDates: [...new Set(dates)].sort() };
    if (updated.completedDates.length >= 3) {
      const now = new Date();
      updated.qualifiedAt = now.toISOString();
      // Qualification and both durable grants commit in the same transaction.
      if (this.ledger) {
        const invitee = await this.ledger.grant(userId, "invitation", `${current.id}:invitee`, "premium", "1_day_premium", 1);
        updated.inviteeRewardEndsAt = invitee.endsAt ?? undefined;
        const monthly = all.filter(item => item.inviterUserId === current.inviterUserId && item.inviterRewardEndsAt && item.rewardedAt && sameCalendarMonth(new Date(item.rewardedAt), now)).length;
        if (monthly < 3) {
          const inviter = await this.ledger.grant(current.inviterUserId, "invitation", `${current.id}:inviter`, "premium", "1_day_premium", 1);
          updated.inviterRewardEndsAt = inviter.endsAt ?? undefined;
        }
        updated.rewardedAt = now.toISOString();
      }
    }
    await this.database.updateBodyLogInvitationAttribution(updated);
    return updated;
  }

  // 生成唯一的 6 位邀请码（重试直到不冲突）
  private async generateUniqueInviteCode(maxRetries = 10): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = this.generateInviteCode();
      const existing = await this.database.findBodyLogInvitationByCode(BODYLOG_APP_ID, code);
      if (!existing) {
        return code;
      }
    }
    throw new ApplicationError(500, "BODYLOG_INVITATION_CODE_GENERATION_FAILED", "Failed to generate a unique invite code.");
  }

  // 生成 6 位邀请码
  private generateInviteCode(): string {
    // 生成 6 位字母数字组合的邀请码
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆字符
    const bytes = randomBytes(6); // 使用密码学安全的随机数
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
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

function sameCalendarMonth(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth();
}

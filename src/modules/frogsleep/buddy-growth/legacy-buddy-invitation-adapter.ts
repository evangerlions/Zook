import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

type Domain = "sleep" | "focus";
type TerminalStatus = "accepted" | "declined" | "cancelled";

/** Projects compatibility-route invitations into the canonical aggregate without changing legacy responses. */
export class LegacyBuddyInvitationAdapter {
  constructor(private readonly database: ApplicationDatabase) {}

  async project(domain: Domain, invitationId: string, handoffBaseUrl: string, locale = "zh-CN") {
    const id = `legacy_${domain}_${invitationId}`;
    const existing = await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, id);
    if (existing) return existing;
    const kind = domain === "sleep" ? "sleep_invite" : "focus_invite";
    const child = await this.database.findFrogSleepEntity(kind, FROGSLEEP_APP_ID, invitationId);
    if (!child?.ownerUserId) return undefined;
    const now = new Date().toISOString();
    const recipientEmail = this.email(child.payload);
    let shareCode = String(child.code ?? child.payload.invite_code ?? child.payload.code ?? "").trim().toUpperCase();
    let handoffToken = String(child.token ?? child.payload.invite_token ?? child.payload.token ?? "").trim();
    if (!shareCode || await this.database.findFrogSleepBuddyInvitationBundleByCode(FROGSLEEP_APP_ID, shareCode)) {
      shareCode = `${domain === "sleep" ? "S" : "F"}${sha256(invitationId).slice(0, 7).toUpperCase()}`;
    }
    if (!handoffToken || await this.database.findFrogSleepBuddyInvitationBundleByToken(FROGSLEEP_APP_ID, handoffToken)) {
      handoffToken = `legacy_${domain}_${sha256(invitationId)}`;
    }
    const base = handoffBaseUrl.startsWith("https://")
      ? handoffBaseUrl : "https://app.youwoai.net/frogsleep/buddy-invitation";
    const separator = base.includes("?") ? "&" : "?";
    const bundle = await this.database.upsertFrogSleepBuddyInvitationBundle({
      id, appId: FROGSLEEP_APP_ID, inviterUserId: child.ownerUserId,
      inviteeUserId: child.partnerUserId, recipientEmail,
      recipientEmailHash: recipientEmail ? sha256(recipientEmail) : undefined,
      shareCode, handoffToken,
      shareLink: `${base}${separator}mode=preview&token=${encodeURIComponent(handoffToken)}`,
      locale, status: this.status(child.status), domains: [domain],
      version: Number(child.payload.version ?? 1),
      domainInvitationIds: { [domain]: invitationId }, domainErrorCodes: {},
      expiresAt: String(child.payload.expires_at ?? child.payload.expiresAt
        ?? new Date(Date.now() + 7 * 86_400_000).toISOString()),
      respondedAt: child.status === "pending" ? undefined : child.updatedAt,
      createdAt: child.createdAt, updatedAt: child.updatedAt,
    });
    await this.database.upsertFrogSleepBuddyInvitationDomainDecision({
      appId: FROGSLEEP_APP_ID, invitationId: id, domain, status: bundle.status,
      version: bundle.version, createdAt: bundle.createdAt, updatedAt: bundle.updatedAt,
    });
    await this.database.updateFrogSleepEntity(kind, FROGSLEEP_APP_ID, invitationId, {
      payload: { ...child.payload, bundle_id: id },
    });
    if (recipientEmail && !await this.database.findFrogSleepBuddyInvitationEmailDelivery(FROGSLEEP_APP_ID, id)) {
      await this.database.enqueueFrogSleepBuddyInvitationEmailDelivery({
        id: randomId("buddy_email_delivery"), appId: FROGSLEEP_APP_ID, invitationId: id,
        recipientEmail, recipientEmailHash: sha256(recipientEmail), locale, status: "queued",
        attemptCount: 0, availableAt: now, createdAt: now, updatedAt: now,
      });
    }
    await this.database.insertAuditLog({
      id: randomId("audit"), appId: FROGSLEEP_APP_ID, actorUserId: child.ownerUserId,
      action: "frogsleep_buddy_legacy_invitation_projected",
      resourceType: "buddy_invitation", resourceId: id, resourceOwnerUserId: child.ownerUserId,
      payload: { domain, compatibility_path: true }, createdAt: now,
    });
    return bundle;
  }

  async syncTerminal(domain: Domain, invitationId: string, status: TerminalStatus, actorUserId: string) {
    const id = `legacy_${domain}_${invitationId}`;
    const bundle = await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, id);
    if (!bundle) return;
    const now = new Date().toISOString();
    await this.database.upsertFrogSleepBuddyInvitationBundle({
      ...bundle, status, version: bundle.version + 1, respondedAt: now, updatedAt: now,
    });
    const decision = await this.database.findFrogSleepBuddyInvitationDomainDecision(
      FROGSLEEP_APP_ID, id, domain,
    );
    await this.database.upsertFrogSleepBuddyInvitationDomainDecision({
      appId: FROGSLEEP_APP_ID, invitationId: id, domain, status,
      version: (decision?.version ?? bundle.version) + 1, decidedByUserId: actorUserId,
      decidedAt: now, createdAt: decision?.createdAt ?? bundle.createdAt, updatedAt: now,
    });
  }

  private email(payload: Record<string, unknown>) {
    const value = String(payload.invitee_email_snapshot ?? payload.inviteeEmailSnapshot ?? "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
  }

  private status(value?: string) {
    return ["accepted", "declined", "cancelled", "expired"].includes(value ?? "")
      ? value as "accepted" | "declined" | "cancelled" | "expired" : "pending";
  }
}

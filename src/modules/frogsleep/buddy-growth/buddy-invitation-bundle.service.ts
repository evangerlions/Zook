import { randomBytes } from "node:crypto";
import { ApplicationError, badRequest, forbidden } from "../../../shared/errors.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import type { NotificationService } from "../../../services/notification.service.ts";
import type { ContentSafetyService } from "../../../services/content-safety.service.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { FrogSleepSleepBuddyService } from "../sleep-buddy/sleep-buddy.service.ts";
import { FrogSleepFocusBuddyService } from "../focus-buddy/focus-buddy.service.ts";
import { BuddyInvitationService } from "./buddy-invitation.service.ts";
import { enqueueBuddyInvitationEvent } from "./buddy-invitation-events.ts";
import { limitBuddyPreview, limitBuddyResponse } from "./buddy-rate-limit.ts";

type BundleDomain = "sleep" | "focus";
type BundleAction = "accept" | "decline" | "cancel";

/** Coordinates sleep and focus child invitations without creating a generic relationship. */
export class BuddyInvitationBundleService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly notificationService?: NotificationService,
    private readonly contentSafetyService?: ContentSafetyService,
    private readonly kvManager?: KVManager,
  ) {}

  async create(input: {
    inviterUserId: string; target: string; domains: string[];
    sleepInviteBaseUrl: string; focusInviteBaseUrl: string; handoffBaseUrl: string; locale?: string;
  }) {
    return await this.database.withExclusiveSession(async () => {
      const domains = this.domains(input.domains);
      const target = await this.resolveTarget(input.target);
      const inviter = await this.database.findUserById(input.inviterUserId);
      if (target.user?.id === input.inviterUserId
        || (target.email && this.normalizeEmail(inviter?.email) === target.email)) {
        badRequest("REQ_INVALID_BODY", "Target user is invalid.");
      }
      const bundleId = randomId("buddy_invitation");
      const shareCode = await this.generateUniqueCode();
      const handoffToken = await this.generateUniqueToken();
      const shareLink = this.buildShareLink(input.handoffBaseUrl, handoffToken);
      const outcomes = target.user
        ? await this.createChildren(bundleId, input, target.user.id, domains)
        : { ids: {}, errors: {} };
      const now = new Date().toISOString();
      const bundle = await this.database.upsertFrogSleepBuddyInvitationBundle({
        id: bundleId, appId: FROGSLEEP_APP_ID, inviterUserId: input.inviterUserId,
        inviteeUserId: target.user?.id, recipientEmail: target.email,
        recipientEmailHash: target.email ? sha256(target.email) : undefined,
        shareCode, handoffToken, shareLink, locale: input.locale ?? "zh-CN",
        status: "pending", domains, version: 1, domainInvitationIds: outcomes.ids,
        domainErrorCodes: outcomes.errors, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        createdAt: now, updatedAt: now,
      });
      await this.ensurePendingDomainDecisions(bundle);
      if (target.email) {
        await this.database.enqueueFrogSleepBuddyInvitationEmailDelivery({
          id: randomId("buddy_email_delivery"), appId: FROGSLEEP_APP_ID, invitationId: bundle.id,
          recipientEmail: target.email, recipientEmailHash: sha256(target.email),
          locale: bundle.locale, status: "queued", attemptCount: 0, availableAt: now,
          createdAt: now, updatedAt: now,
        });
      }
      await enqueueBuddyInvitationEvent(this.database, { recipientUserId: target.user?.id,
        invitationId: bundle.id, domain: "bundle", eventType: "invitation_created" });
      await this.database.insertAuditLog({
        id: randomId("audit"), appId: FROGSLEEP_APP_ID,
        actorUserId: input.inviterUserId, action: "frogsleep_buddy_invitation_created",
        resourceType: "buddy_invitation", resourceId: bundle.id,
        resourceOwnerUserId: input.inviterUserId,
        payload: { domains, target_bound: Boolean(target.user), email_delivery_queued: Boolean(target.email) },
        createdAt: now,
      });
      return this.payload(bundle, input.inviterUserId);
    });
  }

  async ensurePendingDomainDecisions(bundle: FrogSleepBuddyInvitationBundleRecord) {
    for (const domain of bundle.domains) {
      const existing = await this.database.findFrogSleepBuddyInvitationDomainDecision(
        bundle.appId,
        bundle.id,
        domain,
      );
      if (existing) continue;
      await this.database.upsertFrogSleepBuddyInvitationDomainDecision({
        appId: bundle.appId,
        invitationId: bundle.id,
        domain,
        status: "pending",
        version: 1,
        createdAt: bundle.createdAt,
        updatedAt: bundle.createdAt,
      });
    }
  }

  async list(userId: string, direction: "incoming" | "outgoing") {
    const user = direction === "incoming" ? await this.database.findUserById(userId) : undefined;
    const normalizedEmail = this.normalizeEmail(user?.email);
    const bundles = await this.database.listFrogSleepBuddyInvitationBundles({
      appId: FROGSLEEP_APP_ID, userId, direction,
      recipientEmailHash: normalizedEmail ? sha256(normalizedEmail) : undefined,
      recipientEmail: normalizedEmail,
    });
    return await Promise.all(bundles.map((bundle) => this.payload(bundle, userId)));
  }

  async preview(userId: string, bundleId: string) {
    limitBuddyPreview(userId);
    const bundle = await this.requireViewer(userId, bundleId);
    return { ...await this.payload(bundle, userId), viewer_can_accept: bundle.inviterUserId !== userId &&
      await this.canView(bundle, userId) && bundle.status === "pending" && !this.isExpired(bundle),
      proposed_sharing_categories: ["presence", "daily_summary"],
      never_shared_categories: ["raw_health_data", "app_usage_details", "personal_notes", "detailed_timeline"] };
  }

  async previewByLocator(userId: string, locator: { code?: string; token?: string }) {
    limitBuddyPreview(userId);
    const bundle = locator.token
      ? await this.database.findFrogSleepBuddyInvitationBundleByToken(FROGSLEEP_APP_ID, locator.token.trim())
      : locator.code
        ? await this.database.findFrogSleepBuddyInvitationBundleByCode(FROGSLEEP_APP_ID, locator.code.trim())
        : undefined;
    if (!bundle || !await this.canView(bundle, userId)) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
    }
    return await this.preview(userId, bundle.id);
  }

  async respond(
    userId: string,
    bundleId: string,
    action: BundleAction,
    input: { expectedVersion: number; idempotencyKey: string; sharingCategories?: string[] },
  ) {
    limitBuddyResponse(userId);
    return await this.database.withExclusiveSession(async () => {
      let bundle = await this.requireViewer(userId, bundleId);
      await this.assertActor(bundle, userId, action);
      if (bundle.lastIdempotencyKey === input.idempotencyKey && bundle.lastResponseAction === action && bundle.responsePayload) {
        return bundle.responsePayload;
      }
      if (bundle.status !== "pending") throw new ApplicationError(409, "REQ_INVALID_BODY", "Buddy invitation is already terminal.");
      if (bundle.version !== input.expectedVersion) throw new ApplicationError(409, "REQ_INVALID_BODY", "Buddy invitation version conflict.");
      if (action !== "cancel" && !bundle.inviteeUserId) {
        bundle = await this.database.upsertFrogSleepBuddyInvitationBundle({
          ...bundle, inviteeUserId: userId, updatedAt: new Date().toISOString(),
        });
      }
      if (action === "accept") bundle = await this.retryMissingChildren(bundle);
      const results = await this.respondToDomains(bundle, userId, action, input);
      const terminal = results.every((item) => !item.error_code);
      const status = terminal ? this.terminalStatus(action) : "pending";
      const response = { invitation_id: bundle.id, results };
      const now = new Date().toISOString();
      await this.database.upsertFrogSleepBuddyInvitationBundle({ ...bundle, status,
        version: bundle.version + 1, lastIdempotencyKey: input.idempotencyKey,
        lastResponseAction: action, responsePayload: response, respondedAt: terminal ? now : undefined, updatedAt: now });
      if (terminal) await enqueueBuddyInvitationEvent(this.database, {
        recipientUserId: action === "cancel" ? bundle.inviteeUserId : bundle.inviterUserId,
        invitationId: bundle.id, domain: "bundle", eventType: this.eventType(action),
      });
      await this.database.insertAuditLog({
        id: randomId("audit"), appId: FROGSLEEP_APP_ID,
        actorUserId: userId, action: `frogsleep_buddy_invitation_${action}`,
        resourceType: "buddy_invitation", resourceId: bundle.id,
        resourceOwnerUserId: bundle.inviterUserId,
        payload: { domains: bundle.domains, terminal, version: bundle.version + 1 },
        createdAt: now,
      });
      return response;
    });
  }

  private async createChildren(
    bundleId: string,
    input: { inviterUserId: string; target: string; sleepInviteBaseUrl: string; focusInviteBaseUrl: string },
    inviteeUserId: string,
    domains: BundleDomain[],
  ) {
    const ids: Partial<Record<BundleDomain, string>> = {};
    const errors: Partial<Record<BundleDomain, string>> = {};
    for (const domain of domains) {
      try { ids[domain] = await this.createChild(domain, input, inviteeUserId, bundleId); }
      catch (error) { errors[domain] = error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR"; }
    }
    return { ids, errors };
  }

  private async retryMissingChildren(bundle: FrogSleepBuddyInvitationBundleRecord) {
    if (!bundle.inviteeUserId) badRequest("REQ_INVALID_BODY", "Invitation recipient is not bound.");
    const ids = { ...bundle.domainInvitationIds };
    const errors = { ...bundle.domainErrorCodes };
    for (const domain of bundle.domains.filter((item) => !ids[item])) {
      try {
        ids[domain] = await this.createChild(domain, {
          inviterUserId: bundle.inviterUserId, target: bundle.inviteeUserId!,
          sleepInviteBaseUrl: "frogsleep://sleep-buddy-invite",
          focusInviteBaseUrl: "frogsleep://focus-invite",
        }, bundle.inviteeUserId!, bundle.id);
        delete errors[domain];
      } catch (error) {
        errors[domain] = error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR";
      }
    }
    return await this.database.upsertFrogSleepBuddyInvitationBundle({ ...bundle,
      domainInvitationIds: ids, domainErrorCodes: errors, updatedAt: new Date().toISOString() });
  }

  private async createChild(
    domain: BundleDomain,
    input: { inviterUserId: string; target: string; sleepInviteBaseUrl: string; focusInviteBaseUrl: string },
    inviteeUserId: string,
    bundleId: string,
  ): Promise<string> {
    const result = domain === "sleep"
      ? await new FrogSleepSleepBuddyService(this.database, this.notificationService).createInvite({
        userId: input.inviterUserId, invitee: inviteeUserId, sleepInviteBaseUrl: input.sleepInviteBaseUrl, bundleId })
      : await new FrogSleepFocusBuddyService(this.database, this.notificationService, this.contentSafetyService).invite(
        input.inviterUserId, inviteeUserId, input.focusInviteBaseUrl, bundleId);
    const id = String((result as Record<string, unknown>)[domain === "sleep" ? "invite_id" : "source_invite_id"] ?? "");
    if (!id) throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Bundle child invitation was not created.");
    await this.attachBundle(domain, id, bundleId);
    return id;
  }

  private async attachBundle(domain: BundleDomain, invitationId: string, bundleId: string) {
    const kind = domain === "sleep" ? "sleep_invite" : "focus_invite";
    const invite = await this.database.findFrogSleepEntity(kind, FROGSLEEP_APP_ID, invitationId);
    if (invite) await this.database.updateFrogSleepEntity(kind, FROGSLEEP_APP_ID, invitationId,
      { payload: { ...invite.payload, bundle_id: bundleId } });
  }

  private async respondToDomains(
    bundle: FrogSleepBuddyInvitationBundleRecord,
    userId: string,
    action: BundleAction,
    input: { idempotencyKey: string; sharingCategories?: string[] },
  ) {
    const results: Array<Record<string, unknown>> = [];
    for (const domain of bundle.domains) {
      const invitationId = bundle.domainInvitationIds[domain];
      if (!invitationId) { results.push({ domain, status: "pending", error_code: bundle.domainErrorCodes[domain] }); continue; }
      try {
        const completed = await this.completedChildResult(domain, invitationId, action);
        if (completed) { results.push(completed); continue; }
        const result = await new BuddyInvitationService(this.database, this.kvManager).respond(userId, invitationId, action,
          { expectedVersion: await this.childVersion(domain, invitationId), idempotencyKey: `${input.idempotencyKey}:${domain}`,
            sharingCategories: input.sharingCategories, suppressOutbox: true });
        results.push(result.results[0]);
      } catch (error) {
        results.push({ domain, status: "pending", error_code: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR" });
      }
    }
    return results;
  }

  private async completedChildResult(domain: BundleDomain, invitationId: string, action: BundleAction) {
    const kind = domain === "sleep" ? "sleep_invite" : "focus_invite";
    const child = await this.database.findFrogSleepEntity(kind, FROGSLEEP_APP_ID, invitationId);
    const expectedStatus = this.terminalStatus(action);
    if (child?.status !== expectedStatus) return undefined;
    const response = child.payload.unified_response as { results?: Array<Record<string, unknown>> } | undefined;
    return response?.results?.[0] ?? { domain, relationship_id: child.relationshipId, status: expectedStatus, error_code: null };
  }

  private async childVersion(domain: BundleDomain, invitationId: string): Promise<number> {
    const kind = domain === "sleep" ? "sleep_invite" : "focus_invite";
    const child = await this.database.findFrogSleepEntity(kind, FROGSLEEP_APP_ID, invitationId);
    return Number(child?.payload.version ?? 1);
  }

  private async payload(bundle: FrogSleepBuddyInvitationBundleRecord, viewerUserId: string) {
    // `payload` is also called inside an exclusive PostgreSQL session. A single
    // pg client must not execute overlapping queries (deprecated in pg 8 and
    // unsupported in pg 9), so keep these two lookups sequential.
    const inviter = await this.database.findUserById(bundle.inviterUserId);
    const invitee = bundle.inviteeUserId
      ? await this.database.findUserById(bundle.inviteeUserId)
      : undefined;
    return { invitation_id: bundle.id, domain: bundle.domains.length === 1 ? bundle.domains[0] : "bundle",
      domains: bundle.domains,
      direction: bundle.inviterUserId === viewerUserId ? "outgoing" : "incoming", status: bundle.status,
      version: bundle.version, inviter: { user_id: bundle.inviterUserId, display_name: inviter?.email?.split("@")[0] ?? "FrogSleep buddy" },
      invitee: bundle.inviteeUserId ? { user_id: bundle.inviteeUserId, display_name: invitee?.email?.split("@")[0] ?? "FrogSleep buddy" } : undefined,
      viewer_actions: this.actions(bundle, viewerUserId), unread: true, expires_at: bundle.expiresAt,
      created_at: bundle.createdAt, domain_invitation_ids: bundle.domainInvitationIds,
      domain_error_codes: bundle.domainErrorCodes,
      share_link: bundle.inviterUserId === viewerUserId
        ? bundle.shareLink : undefined,
      share_code: bundle.inviterUserId === viewerUserId ? bundle.shareCode : undefined,
      delivery: await this.deliveryPayload(bundle),
      domain_results: bundle.domains.map((domain) => ({ domain, relationship_id: null, status: bundle.status,
        error_code: bundle.domainErrorCodes[domain] ?? null })) };
  }

  private async requireViewer(userId: string, bundleId: string) {
    const bundle = await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, bundleId);
    if (!bundle || !await this.canView(bundle, userId)) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
    }
    if (bundle.status === "pending" && this.isExpired(bundle)) {
      return await this.database.upsertFrogSleepBuddyInvitationBundle({
        ...bundle, status: "expired", version: bundle.version + 1, updatedAt: new Date().toISOString(),
      });
    }
    return bundle;
  }

  private async canView(bundle: FrogSleepBuddyInvitationBundleRecord, userId: string) {
    if ([bundle.inviterUserId, bundle.inviteeUserId].includes(userId)) return true;
    if (bundle.inviteeUserId || !bundle.recipientEmail) return false;
    const user = await this.database.findUserById(userId);
    return this.normalizeEmail(user?.email) === bundle.recipientEmail;
  }

  private async resolveTarget(target: string) {
    const value = target.trim();
    if (!value) badRequest("REQ_INVALID_BODY", "Invitation target is required.");
    if (value.includes("@")) {
      const email = this.normalizeEmail(value);
      if (!email) badRequest("REQ_INVALID_BODY", "Invitation target is invalid.");
      return { email, user: await this.database.findUserByAccount(email) };
    }
    const user = await this.database.findUserById(value);
    if (!user) badRequest("REQ_INVALID_BODY", "Invitation target is invalid.");
    return { email: this.normalizeEmail(user.email), user };
  }

  private domains(values: string[]): BundleDomain[] {
    const domains = [...new Set(values)].filter((value): value is BundleDomain => value === "sleep" || value === "focus");
    if (domains.length === 0 || domains.length !== values.length) badRequest("REQ_INVALID_BODY", "One or more invitation domains are required.");
    return domains;
  }

  private actions(bundle: FrogSleepBuddyInvitationBundleRecord, userId: string) {
    if (bundle.status !== "pending") return ["preview"];
    return bundle.inviteeUserId === userId ? ["preview", "accept", "decline"] : ["preview", "cancel", "share"];
  }

  private async assertActor(bundle: FrogSleepBuddyInvitationBundleRecord, userId: string, action: BundleAction) {
    if (action === "cancel" && bundle.inviterUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the inviter can cancel this invite.");
    if (action !== "cancel" && !await this.canView(bundle, userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can respond to this invite.");
    }
  }

  private terminalStatus(action: BundleAction): "accepted" | "declined" | "cancelled" {
    return action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  }

  private eventType(action: BundleAction): "invitation_accepted" | "invitation_declined" | "invitation_cancelled" {
    return action === "accept" ? "invitation_accepted" : action === "decline" ? "invitation_declined" : "invitation_cancelled";
  }

  private normalizeEmail(value?: string) {
    const normalized = value?.trim().toLowerCase();
    return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
  }

  private async generateUniqueCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const bytes = randomBytes(8);
      const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
      if (!await this.database.findFrogSleepBuddyInvitationBundleByCode(FROGSLEEP_APP_ID, code)) return code;
    }
    throw new ApplicationError(409, "REQ_INVALID_BODY", "Could not allocate an invitation code.");
  }

  private async generateUniqueToken() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const token = randomBytes(32).toString("base64url");
      if (!await this.database.findFrogSleepBuddyInvitationBundleByToken(FROGSLEEP_APP_ID, token)) return token;
    }
    throw new ApplicationError(409, "REQ_INVALID_BODY", "Could not allocate an invitation token.");
  }

  private buildShareLink(baseUrl: string, token: string) {
    const fallback = "https://app.youwoai.net/frogsleep/buddy-invitation";
    const raw = baseUrl.trim() || fallback;
    const base = raw.startsWith("https://") ? raw : fallback;
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}mode=preview&token=${encodeURIComponent(token)}`;
  }

  private async deliveryPayload(bundle: FrogSleepBuddyInvitationBundleRecord) {
    if (!bundle.recipientEmail) return undefined;
    const delivery = await this.database.findFrogSleepBuddyInvitationEmailDelivery(bundle.appId, bundle.id);
    return delivery ? {
      channel: "email",
      status: delivery.status,
      attempt_count: delivery.attemptCount,
      provider_accepted_at: delivery.providerAcceptedAt,
      delivered_at: delivery.deliveredAt,
      last_error_code: delivery.lastErrorCode,
    } : { channel: "email", status: "not_queued" };
  }

  private isExpired(bundle: FrogSleepBuddyInvitationBundleRecord) {
    return new Date(bundle.expiresAt).getTime() <= Date.now();
  }
}

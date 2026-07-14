import { ApplicationError, badRequest, forbidden } from "../../../shared/errors.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import type { NotificationService } from "../../../services/notification.service.ts";
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
  ) {}

  async create(input: {
    inviterUserId: string; target: string; domains: string[];
    sleepInviteBaseUrl: string; focusInviteBaseUrl: string;
  }) {
    const domains = this.domains(input.domains);
    const invitee = await this.resolveInvitee(input.target);
    if (!invitee || invitee.id === input.inviterUserId) badRequest("REQ_INVALID_BODY", "Target user is invalid.");
    const bundleId = randomId("buddy_bundle");
    const outcomes = await this.createChildren(bundleId, input, invitee.id, domains);
    const now = new Date().toISOString();
    const bundle = await this.database.upsertFrogSleepBuddyInvitationBundle({
      id: bundleId, appId: FROGSLEEP_APP_ID, inviterUserId: input.inviterUserId, inviteeUserId: invitee.id,
      status: "pending", domains, version: 1, domainInvitationIds: outcomes.ids,
      domainErrorCodes: outcomes.errors, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      createdAt: now, updatedAt: now,
    });
    await this.ensurePendingDomainDecisions(bundle);
    await enqueueBuddyInvitationEvent(this.database, { recipientUserId: invitee.id,
      invitationId: bundle.id, domain: "bundle", eventType: "invitation_created" });
    return this.payload(bundle, input.inviterUserId);
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
    const bundles = await this.database.listFrogSleepBuddyInvitationBundles({
      appId: FROGSLEEP_APP_ID, userId, direction,
    });
    return await Promise.all(bundles.map((bundle) => this.payload(bundle, userId)));
  }

  async preview(userId: string, bundleId: string) {
    limitBuddyPreview(userId);
    const bundle = await this.requireViewer(userId, bundleId);
    return { ...await this.payload(bundle, userId), viewer_can_accept: bundle.inviteeUserId === userId &&
      bundle.status === "pending" && Object.keys(bundle.domainInvitationIds).length > 0,
      proposed_sharing_categories: ["presence", "daily_summary"],
      never_shared_categories: ["raw_health_data", "app_usage_details", "personal_notes", "detailed_timeline"] };
  }

  async respond(
    userId: string,
    bundleId: string,
    action: BundleAction,
    input: { expectedVersion: number; idempotencyKey: string; sharingCategories?: string[] },
  ) {
    limitBuddyResponse(userId);
    let bundle = await this.requireViewer(userId, bundleId);
    this.assertActor(bundle, userId, action);
    if (bundle.lastIdempotencyKey === input.idempotencyKey && bundle.lastResponseAction === action && bundle.responsePayload) {
      return bundle.responsePayload;
    }
    if (bundle.status !== "pending") throw new ApplicationError(409, "REQ_INVALID_BODY", "Buddy invitation is already terminal.");
    if (bundle.version !== input.expectedVersion) throw new ApplicationError(409, "REQ_INVALID_BODY", "Buddy invitation version conflict.");
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
    return response;
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
      : await new FrogSleepFocusBuddyService(this.database, this.notificationService).invite(
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
        const result = await new BuddyInvitationService(this.database).respond(userId, invitationId, action,
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
    const [inviter, invitee] = await Promise.all([
      this.database.findUserById(bundle.inviterUserId),
      bundle.inviteeUserId ? this.database.findUserById(bundle.inviteeUserId) : undefined,
    ]);
    return { invitation_id: bundle.id, domain: "bundle", domains: bundle.domains,
      direction: bundle.inviterUserId === viewerUserId ? "outgoing" : "incoming", status: bundle.status,
      version: bundle.version, inviter: { user_id: bundle.inviterUserId, display_name: inviter?.email?.split("@")[0] ?? "FrogSleep buddy" },
      invitee: bundle.inviteeUserId ? { user_id: bundle.inviteeUserId, display_name: invitee?.email?.split("@")[0] ?? "FrogSleep buddy" } : undefined,
      viewer_actions: this.actions(bundle, viewerUserId), unread: true, expires_at: bundle.expiresAt,
      created_at: bundle.createdAt, domain_invitation_ids: bundle.domainInvitationIds,
      domain_error_codes: bundle.domainErrorCodes,
      share_link: bundle.inviterUserId === viewerUserId
        ? `frogsleep://buddy-invitation?mode=preview&invitation_id=${encodeURIComponent(bundle.id)}` : undefined,
      domain_results: bundle.domains.map((domain) => ({ domain, relationship_id: null, status: bundle.status,
        error_code: bundle.domainErrorCodes[domain] ?? null })) };
  }

  private async requireViewer(userId: string, bundleId: string) {
    const bundle = await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, bundleId);
    if (!bundle || ![bundle.inviterUserId, bundle.inviteeUserId].includes(userId)) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
    }
    return bundle;
  }

  private async resolveInvitee(target: string) {
    return await this.database.findUserById(target.trim()) ?? await this.database.findUserByAccount(target.trim());
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

  private assertActor(bundle: FrogSleepBuddyInvitationBundleRecord, userId: string, action: BundleAction) {
    if (action === "cancel" && bundle.inviterUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the inviter can cancel this invite.");
    if (action !== "cancel" && bundle.inviteeUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can respond to this invite.");
  }

  private terminalStatus(action: BundleAction): "accepted" | "declined" | "cancelled" {
    return action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  }

  private eventType(action: BundleAction): "invitation_accepted" | "invitation_declined" | "invitation_cancelled" {
    return action === "accept" ? "invitation_accepted" : action === "decline" ? "invitation_declined" : "invitation_cancelled";
  }
}

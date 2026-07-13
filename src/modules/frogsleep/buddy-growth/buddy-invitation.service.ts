import { ApplicationError, badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord, UserRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { acceptSleepInviteById, sleepInviteAction } from "../sleep-buddy/sleep-buddy-invites.ts";
import { acceptFocusInviteById, focusInviteAction } from "../focus-buddy/focus-buddy-invites.ts";
import { legacyInviteDomain, type BuddyInvitationAction, type BuddyInvitationDirection } from "./buddy-growth-contract.ts";
import { BuddyConsentService } from "./buddy-consent.service.ts";
import { enqueueBuddyInvitationEvent } from "./buddy-invitation-events.ts";
import { limitBuddyPreview, limitBuddyResponse } from "./buddy-rate-limit.ts";

interface InvitationView {
  invitation_id: string;
  relationship_id?: string;
  domain: "sleep" | "focus";
  direction: BuddyInvitationDirection;
  status: string;
  version: number;
  inviter: { user_id: string; display_name: string };
  invitee?: { user_id: string; display_name: string };
  viewer_actions: BuddyInvitationAction[];
  unread: boolean;
  expires_at: string;
  created_at: string;
}

/** Unified read model over existing sleep and focus invitation sources. */
export class BuddyInvitationService {
  constructor(private readonly database: ApplicationDatabase) {}

  async list(userId: string, direction: BuddyInvitationDirection, limit = 50, cursor?: string) {
    const records = await this.invitesFor(userId, direction);
    const views = await Promise.all(records.map((record) => this.toView(record, userId, direction)));
    const sorted = views
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.invitation_id.localeCompare(a.invitation_id))
      .filter((item) => !cursor || `${item.created_at}|${item.invitation_id}` < cursor)
      .slice(0, limit);
    const last = sorted.at(-1);
    return {
      invitations: sorted,
      next_cursor: sorted.length === limit && last ? `${last.created_at}|${last.invitation_id}` : undefined,
    };
  }

  async previewById(userId: string, invitationId: string) {
    const invite = await this.findInvite(invitationId);
    if (!invite || !this.canView(invite, userId)) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
    }
    const direction: BuddyInvitationDirection = invite.ownerUserId === userId ? "outgoing" : "incoming";
    const view = await this.toView(invite, userId, direction);
    return {
      ...view,
      viewer_can_accept: direction === "incoming" && invite.status === "pending" && !this.isExpired(invite),
      proposed_sharing_categories: ["presence", "daily_summary"],
      never_shared_categories: ["raw_health_data", "app_usage_details", "personal_notes", "detailed_timeline"],
      share_code: direction === "outgoing" ? invite.code : undefined,
      share_link: direction === "outgoing" ? String(invite.payload.shareLink ?? invite.payload.share_link ?? "") || undefined : undefined,
    };
  }

  async preview(userId: string, locator: { invitationId?: string; token?: string; code?: string; notificationId?: string }) {
    limitBuddyPreview(userId);
    const invite = await this.resolveLocator(userId, locator);
    if (!invite || !this.canView(invite, userId)) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
    }
    return this.previewById(userId, invite.id);
  }

  async respond(
    userId: string,
    invitationId: string,
    action: "accept" | "decline" | "cancel",
    input: { expectedVersion: number; idempotencyKey: string; sharingCategories?: string[]; suppressOutbox?: boolean },
  ) {
    limitBuddyResponse(userId);
    return this.database.withExclusiveSession(async () => {
      const invite = await this.findInvite(invitationId);
      if (!invite || !this.canView(invite, userId)) throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
      const previousKey = String(invite.payload.last_idempotency_key ?? "");
      const previousAction = String(invite.payload.last_response_action ?? "");
      if (invite.status !== "pending") {
        if (previousKey === input.idempotencyKey && previousAction === action && invite.payload.unified_response) {
          return invite.payload.unified_response;
        }
        conflict("REQ_INVALID_BODY", "Buddy invitation is already terminal.");
      }
      const currentVersion = Number(invite.payload.version ?? 1);
      if (currentVersion !== input.expectedVersion) conflict("REQ_INVALID_BODY", "Buddy invitation version conflict.");
      this.assertActionActor(invite, userId, action);
      const domain = legacyInviteDomain(invite.kind);
      if (!domain || domain === "bundle") badRequest("REQ_INVALID_BODY", "Unsupported buddy invitation domain.");

      let relationshipId = invite.relationshipId;
      if (action === "accept") {
        const accepted = domain === "sleep"
          ? await acceptSleepInviteById({ database: this.database }, userId, invite.id)
          : await acceptFocusInviteById({ database: this.database }, userId, invite.id);
        relationshipId = String((accepted as Record<string, unknown>).relationship_id ?? (accepted as Record<string, unknown>).id ?? relationshipId ?? "");
        const proposed = this.sharingCategories(invite.payload.proposed_sharing_categories);
        await new BuddyConsentService(this.database).createAcceptanceGrants({
          relationshipId, domain, inviterUserId: invite.ownerUserId!, inviteeUserId: invite.partnerUserId!,
          proposedCategories: proposed, selectedCategories: input.sharingCategories ?? proposed,
        });
      } else if (domain === "sleep") {
        await sleepInviteAction({ database: this.database }, userId, invite.id, action);
      } else {
        await focusInviteAction({ database: this.database }, userId, invite.id, action);
      }
      const status = action === "accept" ? "accepted" : action === "cancel" ? "cancelled" : "declined";
      const response = {
        invitation_id: invite.id,
        results: [{ domain, relationship_id: relationshipId || undefined, status, error_code: null }],
      };
      const terminalInvite = await this.findInvite(invite.id);
      await this.database.updateFrogSleepEntity(invite.kind, FROGSLEEP_APP_ID, invite.id, {
        payload: {
          ...(terminalInvite?.payload ?? invite.payload),
          version: currentVersion + 1,
          last_idempotency_key: input.idempotencyKey,
          last_response_action: action,
          selected_sharing_categories: input.sharingCategories ?? [],
          unified_response: response,
        },
      });
      if (!input.suppressOutbox) await enqueueBuddyInvitationEvent(this.database, {
        recipientUserId: action === "cancel" ? invite.partnerUserId : invite.ownerUserId,
        invitationId: invite.id, domain,
        eventType: action === "accept" ? "invitation_accepted" : action === "decline" ? "invitation_declined" : "invitation_cancelled",
      });
      return response;
    });
  }

  private async invitesFor(userId: string, direction: BuddyInvitationDirection) {
    const filterKey = direction === "incoming" ? "partnerUserId" : "ownerUserId";
    const [sleep, focus] = await Promise.all([
      this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "sleep_invite", [filterKey]: userId }),
      this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_invite", [filterKey]: userId }),
    ]);
    return [...sleep, ...focus].filter((invite) => !invite.payload.bundle_id);
  }

  private async findInvite(id: string) {
    return await this.database.findFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, id)
      ?? await this.database.findFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, id);
  }

  private async resolveLocator(
    userId: string,
    locator: { invitationId?: string; token?: string; code?: string; notificationId?: string },
  ) {
    if (locator.invitationId) return this.findInvite(locator.invitationId);
    if (locator.token) {
      return await this.database.findFrogSleepEntityByToken("sleep_invite", FROGSLEEP_APP_ID, locator.token)
        ?? await this.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, locator.token);
    }
    if (locator.code) {
      return await this.database.findFrogSleepEntityByCode("sleep_invite", FROGSLEEP_APP_ID, locator.code)
        ?? await this.database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, locator.code);
    }
    if (locator.notificationId) {
      const job = await this.database.findNotificationJob(locator.notificationId);
      if (!job || job.appId !== FROGSLEEP_APP_ID || job.recipientUserId !== userId) return undefined;
      const invitationId = String(job.payload.entityId ?? job.payload.entity_id ?? "");
      return invitationId ? this.findInvite(invitationId) : undefined;
    }
    badRequest("REQ_INVALID_BODY", "An invitation locator is required.");
  }

  private canView(invite: FrogSleepEntityRecord, userId: string) {
    return invite.ownerUserId === userId || invite.partnerUserId === userId;
  }

  private assertActionActor(invite: FrogSleepEntityRecord, userId: string, action: string) {
    if (action === "cancel" && invite.ownerUserId !== userId) forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the inviter can cancel this invite.");
    if ((action === "accept" || action === "decline") && invite.partnerUserId !== userId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Only the invitee can respond to this invite.");
    }
  }

  private async toView(invite: FrogSleepEntityRecord, userId: string, direction: BuddyInvitationDirection): Promise<InvitationView> {
    const domain = legacyInviteDomain(invite.kind);
    if (!domain || domain === "bundle" || !invite.ownerUserId) badRequest("REQ_INVALID_BODY", "Invalid buddy invitation projection.");
    const [inviter, invitee] = await Promise.all([
      this.database.findUserById(invite.ownerUserId),
      invite.partnerUserId ? this.database.findUserById(invite.partnerUserId) : undefined,
    ]);
    const status = this.isExpired(invite) && invite.status === "pending" ? "expired" : invite.status ?? "pending";
    return {
      invitation_id: invite.id,
      relationship_id: invite.relationshipId,
      domain,
      direction,
      status,
      version: Number(invite.payload.version ?? 1),
      inviter: this.identity(invite.ownerUserId, inviter),
      invitee: invite.partnerUserId ? this.identity(invite.partnerUserId, invitee) : undefined,
      viewer_actions: this.actions(status, direction),
      unread: direction === "incoming"
        ? !invite.payload.recipient_read_at
        : !invite.payload.sender_read_at,
      expires_at: this.expiresAt(invite),
      created_at: invite.createdAt,
    };
  }

  private actions(status: string, direction: BuddyInvitationDirection): BuddyInvitationAction[] {
    if (status !== "pending") return ["preview"];
    return direction === "incoming" ? ["preview", "accept", "decline"] : ["preview", "cancel", "share"];
  }

  private identity(userId: string, user?: UserRecord) {
    return { user_id: userId, display_name: user?.email?.split("@")[0] ?? "FrogSleep buddy" };
  }

  private expiresAt(invite: FrogSleepEntityRecord): string {
    return String(invite.payload.expires_at ?? invite.payload.expiresAt ?? invite.updatedAt);
  }

  private isExpired(invite: FrogSleepEntityRecord): boolean {
    return new Date(this.expiresAt(invite)).getTime() <= Date.now();
  }

  private sharingCategories(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : ["presence", "daily_summary"];
  }
}

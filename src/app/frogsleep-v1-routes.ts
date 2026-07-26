import { randomUUID } from "node:crypto";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { FROGSLEEP_APP_ID } from "../modules/frogsleep/frogsleep-app.ts";
import { FrogSleepFocusBuddyService } from "../modules/frogsleep/focus-buddy/focus-buddy.service.ts";
import { LegacyBuddyInvitationAdapter } from "../modules/frogsleep/buddy-growth/legacy-buddy-invitation-adapter.ts";
import { FrogSleepProductDataService } from "../modules/frogsleep/product-data/frogsleep-product-data.service.ts";
import { emitFrogSleepAnalyticsEvent } from "../modules/frogsleep/frogsleep-analytics.ts";
import { parsePaginationParams } from "../modules/frogsleep/frogsleep-validation.ts";
import { FrogSleepSleepBuddyService } from "../modules/frogsleep/sleep-buddy/sleep-buddy.service.ts";
import { tryHandleBuddyGrowthRoutes } from "./frogsleep-v1-buddy-routes.ts";
import { tryHandleBuddyCapabilitiesRoutes } from "./frogsleep-v1-buddy-capabilities-routes.ts";
import { tryHandleBuddySafetyRoutes } from "./frogsleep-v1-buddy-safety-routes.ts";
import { resolveBuddyGrowthCapabilities } from "../modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import { ApplicationError } from "../shared/errors.ts";
import { asBody, authenticateFrogSleepRequest, dualResourcePayload, frogSleepOk,
  getFrogSleepInviteLinks, redirectTo, requireStringField } from "./frogsleep-v1-common.ts";
import {
  handleFrogSleepChangePassword,
  handleFrogSleepDeleteAccount,
  handleFrogSleepDeleteDevice,
  handleFrogSleepEmailBindOrChange,
  handleFrogSleepEmailChangeCode,
  handleFrogSleepEmailCode,
  handleFrogSleepEmailLogin,
  handleFrogSleepLogout,
  handleFrogSleepMe,
  handleFrogSleepPasswordLogin,
  handleFrogSleepPasswordRegister,
  handleFrogSleepPasswordResetConfirm,
  handleFrogSleepPasswordResetRequest,
  handleFrogSleepRefresh,
  handleFrogSleepRegisterDevice,
} from "./frogsleep-v1-auth-routes.ts";
import {
  handleSleepActiveSession,
  handleSleepCurrentRelationship,
  handleSleepInviteAcceptCode,
  handleSleepInviteAcceptToken,
  handleSleepInviteAction,
  handleSleepInviteCreate,
  handleSleepLatestRecap,
  handleSleepLatestSummary,
  handleSleepPauseTonight,
  handleSleepPendingInvites,
  handleSleepPreferenceUpdate,
  handleSleepRelationshipAction,
  handleSleepRelationshipStatus,
  handleSleepSessionAccept,
  handleSleepSessionBegin,
  handleSleepSessionEvent,
} from "./frogsleep-v1-sleep-routes.ts";

const FROGSLEEP_CANONICAL_PREFIX = "/api/v1/frogsleep";
const LEGACY_INVITATION_HEADERS = {
  Deprecation: "true",
  Link: '</api/v1/frogsleep/buddy/invitations>; rel="successor-version"',
};

export function isFrogSleepV1Path(path: string): boolean {
  return (
    path === FROGSLEEP_CANONICAL_PREFIX ||
    path.startsWith(`${FROGSLEEP_CANONICAL_PREFIX}/`)
  );
}

function normalizeFrogSleepPath(path: string): string {
  if (!path.startsWith(FROGSLEEP_CANONICAL_PREFIX)) {
    return path;
  }

  const suffix = path.slice(FROGSLEEP_CANONICAL_PREFIX.length) || "/";
  if (suffix === "/devices") return "/v1/me/devices";
  if (suffix.startsWith("/devices/")) return `/v1/me${suffix}`;
  if (suffix.startsWith("/sleep-buddy/invites")) {
    return `/v1/relationships${suffix.slice("/sleep-buddy".length)}`;
  }
  if (suffix === "/sleep-buddy/relationships/current") return "/v1/relationships/current";
  if (suffix.startsWith("/sleep-buddy/relationships/")) {
    return `/v1/relationships/${suffix.slice("/sleep-buddy/relationships/".length)}`;
  }
  if (suffix === "/sleep-buddy/guardianship/status") return "/v1/shared-guardianship/status";
  if (suffix.startsWith("/sleep-buddy/shared-sessions")) {
    return `/v1/shared-sessions${suffix.slice("/sleep-buddy/shared-sessions".length)}`;
  }
  if (suffix.startsWith("/sleep-buddy/shared-summaries")) {
    return `/v1/shared-summaries${suffix.slice("/sleep-buddy/shared-summaries".length)}`;
  }
  if (suffix.startsWith("/sleep-buddy/shared-recaps")) {
    return `/v1/shared-recaps${suffix.slice("/sleep-buddy/shared-recaps".length)}`;
  }
  if (suffix.startsWith("/product-data/")) {
    return `/v1/product-data${suffix.slice("/product-data".length)}`;
  }
  for (const focusBuddyResource of ["invites", "messages", "presence", "comparison", "shared"]) {
    if (suffix === `/focus-buddy/${focusBuddyResource}` || suffix.startsWith(`/focus-buddy/${focusBuddyResource}/`)) {
      return `/v1/focus/buddy/${focusBuddyResource}${suffix.slice(`/focus-buddy/${focusBuddyResource}`.length)}`;
    }
  }
  if (suffix.startsWith("/focus-buddy/")) {
    return `/v1/focus/${suffix.slice("/focus-buddy/".length)}`;
  }
  return `/v1${suffix}`;
}

function focusBuddyService(context: BackendRouteContext): FrogSleepFocusBuddyService {
  return new FrogSleepFocusBuddyService(context.database, context.notificationService);
}

function productDataService(context: BackendRouteContext): FrogSleepProductDataService {
  return new FrogSleepProductDataService(context.database);
}

async function trackInviteOpenBestEffort(track: () => Promise<void>): Promise<void> {
  try {
    await track();
  } catch {
    // Invite redirect tracking must not interrupt public deep-link redirects.
  }
}


export async function tryHandleFrogSleepV1Routes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!isFrogSleepV1Path(request.path)) {
    if (request.method === "GET" && request.path === "/frogsleep/buddy-invitation") {
      const token = String(request.query?.token ?? "").trim();
      const bundle = token
        ? await this.database.findFrogSleepBuddyInvitationBundleByToken(FROGSLEEP_APP_ID, token)
        : undefined;
      if (bundle) {
        await trackInviteOpenBestEffort(async () => {
          await this.database.insertAuditLog({
            id: randomUUID(), appId: FROGSLEEP_APP_ID,
            action: "frogsleep_buddy_invitation_handoff_opened",
            resourceType: "buddy_invitation", resourceId: bundle.id,
            resourceOwnerUserId: bundle.inviterUserId,
            payload: { channel: "https_handoff" },
            createdAt: new Date().toISOString(),
          });
        });
      }
      const deepLink = `frogsleep://buddy-invitation?mode=preview&token=${encodeURIComponent(token)}`;
      const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
        + `<meta name="viewport" content="width=device-width,initial-scale=1">`
        + `<meta http-equiv="refresh" content="0;url=${deepLink}"><title>FrogSleep 搭子邀请</title></head>`
        + `<body><main><h1>FrogSleep 搭子邀请</h1>`
        + `<p>正在打开 FrogSleep。若未自动打开，可点击下方按钮；也可在 App 的搭子中心手动输入邀请码。</p>`
        + `<p><a href="${deepLink}">打开 FrogSleep</a></p></main></body></html>`;
      return {
        statusCode: 200,
        contentType: "text/html; charset=utf-8",
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
        body: {
          code: "OK", message: "success", data: null,
          requestId: request.requestId as string,
        },
        streamBody: (async function* () { yield html; })(),
      };
    }
    if (request.method === "GET" && request.path === "/frogsleep/sleep-buddy-invite") {
      const token = request.query?.token ?? "";
      const code = request.query?.code ?? "";
      await trackInviteOpenBestEffort(async () => {
        await new FrogSleepSleepBuddyService(this.database, this.notificationService)
          .trackInviteOpenByToken(String(token), request.headers?.["user-agent"]);
      });
      return redirectTo(
        `frogsleep://sleep-buddy-invite?mode=preview&token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
        request.requestId as string,
      );
    }
    if (request.method === "GET" && request.path === "/frogsleep/focus-invite") {
      const token = request.query?.token ?? "";
      const code = request.query?.code ?? "";
      await trackInviteOpenBestEffort(async () => {
        await focusBuddyService(this)
          .trackInviteOpenByToken(String(token), request.headers?.["user-agent"]);
      });
      return redirectTo(
        `frogsleep://focus-invite?mode=preview&token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
        request.requestId as string,
      );
    }
    return undefined;
  }
  const routePath = normalizeFrogSleepPath(request.path);
  const routeRequest = routePath === request.path ? request : { ...request, path: routePath };

  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/send-code") {
    return await handleFrogSleepEmailCode(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/auth-code") {
    return await handleFrogSleepEmailCode(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/change-code") {
    return await handleFrogSleepEmailChangeCode(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/verify") {
    return await handleFrogSleepEmailLogin(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/login") {
    return await handleFrogSleepEmailLogin(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/complete") {
    return await handleFrogSleepEmailLogin(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/register") {
    return await handleFrogSleepPasswordRegister(this, routeRequest, { sendCodeWhenMissing: true });
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/bind") {
    return await handleFrogSleepEmailBindOrChange(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/email/change") {
    return await handleFrogSleepEmailBindOrChange(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/password/register") {
    return await handleFrogSleepPasswordRegister(this, routeRequest, { sendCodeWhenMissing: true });
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/password/login") {
    return await handleFrogSleepPasswordLogin(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/password/reset/request") {
    return await handleFrogSleepPasswordResetRequest(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/password/reset/confirm") {
    return await handleFrogSleepPasswordResetConfirm(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/password/change") {
    return await handleFrogSleepChangePassword(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/token/refresh") {
    return await handleFrogSleepRefresh(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/auth/logout") {
    return await handleFrogSleepLogout(this, routeRequest);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/me") {
    return await handleFrogSleepMe(this, routeRequest);
  }
  if (routeRequest.method === "DELETE" && routeRequest.path === "/v1/me/account") {
    return await handleFrogSleepDeleteAccount(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/me/devices") {
    return await handleFrogSleepRegisterDevice(this, routeRequest);
  }
  const deleteDeviceMatch = routeRequest.path.match(/^\/v1\/me\/devices\/([^/]+)$/);
  if (routeRequest.method === "DELETE" && deleteDeviceMatch) {
    return await handleFrogSleepDeleteDevice(this, routeRequest, decodeURIComponent(deleteDeviceMatch[1] as string));
  }
  const buddySafetyResponse = await tryHandleBuddySafetyRoutes(this, routeRequest);
  if (buddySafetyResponse) return buddySafetyResponse;
  const buddyCapabilitiesResponse = await tryHandleBuddyCapabilitiesRoutes(this, routeRequest);
  if (buddyCapabilitiesResponse) return buddyCapabilitiesResponse;
  const buddyGrowthResponse = await tryHandleBuddyGrowthRoutes(this, routeRequest);
  if (buddyGrowthResponse) return buddyGrowthResponse;
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/relationships/invites") {
    return await handleSleepInviteCreate(this, routeRequest);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/relationships/invites/preview") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await new FrogSleepSleepBuddyService(this.database, this.notificationService).previewInvite(auth.userId, {
      token: routeRequest.query?.token,
      code: routeRequest.query?.code,
    }), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/relationships/invites/pending") {
    return await handleSleepPendingInvites(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/relationships/invites/accept-code") {
    return await handleSleepInviteAcceptCode(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/relationships/invites/accept-token") {
    return await handleSleepInviteAcceptToken(this, routeRequest);
  }
  const inviteActionMatch = routeRequest.path.match(/^\/v1\/relationships\/invites\/([^/]+)\/(accept|decline|cancel)$/);
  if (routeRequest.method === "POST" && inviteActionMatch) {
    return await handleSleepInviteAction(
      this,
      routeRequest,
      decodeURIComponent(inviteActionMatch[1] as string),
      inviteActionMatch[2] as "accept" | "decline" | "cancel",
    );
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/relationships/current") {
    return await handleSleepCurrentRelationship(this, routeRequest);
  }
  const relationshipActionMatch = routeRequest.path.match(/^\/v1\/relationships\/([^/]+)\/(pause|resume|revoke)$/);
  if (routeRequest.method === "POST" && relationshipActionMatch) {
    return await handleSleepRelationshipAction(
      this,
      routeRequest,
      decodeURIComponent(relationshipActionMatch[1] as string),
      relationshipActionMatch[2] as "pause" | "resume" | "revoke",
    );
  }
  const preferenceMatch = routeRequest.path.match(/^\/v1\/relationships\/([^/]+)\/preferences$/);
  if (routeRequest.method === "PATCH" && preferenceMatch) {
    return await handleSleepPreferenceUpdate(this, routeRequest, decodeURIComponent(preferenceMatch[1] as string));
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/shared-guardianship/status") {
    return await handleSleepRelationshipStatus(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/shared-sessions") {
    return await handleSleepSessionBegin(this, routeRequest);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/shared-sessions/active") {
    return await handleSleepActiveSession(this, routeRequest);
  }
  const sessionActionMatch = routeRequest.path.match(/^\/v1\/shared-sessions\/([^/]+)\/(accept|events|pause-tonight)$/);
  if (routeRequest.method === "POST" && sessionActionMatch) {
    const sessionId = decodeURIComponent(sessionActionMatch[1] as string);
    const action = sessionActionMatch[2];
    if (action === "accept") {
      return await handleSleepSessionAccept(this, routeRequest, sessionId);
    }
    if (action === "events") {
      return await handleSleepSessionEvent(this, routeRequest, sessionId);
    }
    return await handleSleepPauseTonight(this, routeRequest, sessionId);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/shared-summaries/latest") {
    return await handleSleepLatestSummary(this, routeRequest);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/shared-recaps/latest") {
    return await handleSleepLatestRecap(this, routeRequest);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/sessions") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const result = await focusBuddyService(this).reportSession(auth.userId, asBody(routeRequest));
    emitFrogSleepAnalyticsEvent(
      { analyticsService: this.analyticsService },
      { name: "frogsleep_focus_session_reported", appId: FROGSLEEP_APP_ID, userId: auth.userId, metadata: { session_id: result.id } },
    );
    return frogSleepOk(this, result, routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/sessions") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const result = await focusBuddyService(this).sessions(
      auth.userId,
      routeRequest.query?.from,
      routeRequest.query?.to,
      parsePaginationParams(routeRequest.query),
    );
    return frogSleepOk(this, result, routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/stats/week") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).weekStats(auth.userId), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/achievements") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      await focusBuddyService(this).achievements(auth.userId, parsePaginationParams(routeRequest.query)),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/achievements/notify") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, dualResourcePayload(
      "achievement",
      await focusBuddyService(this).notifyAchievement(
        auth.userId,
        requireStringField(asBody(routeRequest), "milestone_id", "milestoneId"),
      ),
    ), routeRequest.requestId as string);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/match-profile") {
    if (!resolveBuddyGrowthCapabilities().focusMatching) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Focus buddy matching is not available.");
    }
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).saveProfile(auth.userId, asBody(routeRequest)), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/match-profile/me") {
    if (!resolveBuddyGrowthCapabilities().focusMatching) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Focus buddy matching is not available.");
    }
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      dualResourcePayload("profile", await focusBuddyService(this).getProfile(auth.userId)),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "DELETE" && routeRequest.path === "/v1/focus/match-profile") {
    if (!resolveBuddyGrowthCapabilities().focusMatching) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Focus buddy matching is not available.");
    }
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).deleteProfile(auth.userId), routeRequest.requestId as string);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/matches/search") {
    if (!resolveBuddyGrowthCapabilities().focusMatching) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Focus buddy matching is not available.");
    }
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const limit = parsePaginationParams(asBody(routeRequest)).limit;
    return frogSleepOk(this, await focusBuddyService(this).searchMatches(auth.userId, limit), routeRequest.requestId as string);
  }
  const focusInviteMatch = routeRequest.path.match(/^\/v1\/focus\/matches\/([^/]+)\/invite$/);
  if (routeRequest.method === "POST" && focusInviteMatch) {
    if (!resolveBuddyGrowthCapabilities().focusMatching) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Focus buddy matching is not available.");
    }
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const inviteLinks = await getFrogSleepInviteLinks(this);
    return frogSleepOk(this, await focusBuddyService(this).invite(
      auth.userId,
      decodeURIComponent(focusInviteMatch[1] as string),
      inviteLinks.focusBuddyBaseUrl,
    ), routeRequest.requestId as string);
  }
  const focusMatchFeedbackMatch = routeRequest.path.match(/^\/v1\/focus\/matches\/([^/]+)\/(dismiss|report)$/);
  if (routeRequest.method === "POST" && focusMatchFeedbackMatch) {
    if (!resolveBuddyGrowthCapabilities().focusMatching) {
      throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Focus buddy matching is not available.");
    }
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).recordMatchFeedback(
      auth.userId,
      decodeURIComponent(focusMatchFeedbackMatch[1] as string),
      focusMatchFeedbackMatch[2] === "report" ? "reported" : "dismissed",
      asBody(routeRequest),
    ), routeRequest.requestId as string);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/buddy/invites") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const body = asBody(routeRequest);
    const inviteLinks = await getFrogSleepInviteLinks(this);
    const invite = await focusBuddyService(this).invite(
      auth.userId,
      requireStringField(body, "target", "email", "user_id", "userId"),
      inviteLinks.focusBuddyBaseUrl,
    );
    await new LegacyBuddyInvitationAdapter(this.database).project(
      "focus", String(invite.source_invite_id ?? invite.invite_id ?? invite.id),
      inviteLinks.buddyHandoffBaseUrl, this.resolveRequestLocale(routeRequest),
    );
    return frogSleepOk(this, invite, routeRequest.requestId as string, LEGACY_INVITATION_HEADERS);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/buddy/invites/preview") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).previewInvite(auth.userId, {
      token: routeRequest.query?.token,
      code: routeRequest.query?.code,
    }), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/buddy/invites/pending") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).pendingInvites(auth.userId), routeRequest.requestId as string);
  }
  const focusInviteActionMatch = routeRequest.path.match(/^\/v1\/focus\/buddy\/invites\/([^/]+)\/(decline|cancel)$/);
  if (routeRequest.method === "POST" && focusInviteActionMatch) {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const invitationId = decodeURIComponent(focusInviteActionMatch[1] as string);
    const action = focusInviteActionMatch[2] as "decline" | "cancel";
    const result = await focusBuddyService(this).inviteAction(
      auth.userId,
      invitationId,
      action,
    );
    await new LegacyBuddyInvitationAdapter(this.database).syncTerminal(
      "focus", invitationId, action, auth.userId,
    );
    return frogSleepOk(this, result, routeRequest.requestId as string, LEGACY_INVITATION_HEADERS);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/buddy/invites/accept-code") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const relationship = await focusBuddyService(this).acceptInviteByCode(
      auth.userId, requireStringField(asBody(routeRequest), "code"),
    );
    await new LegacyBuddyInvitationAdapter(this.database).syncTerminal(
      "focus", String(relationship.source_invite_id ?? ""), "accepted", auth.userId,
    );
    return frogSleepOk(this, relationship, routeRequest.requestId as string, LEGACY_INVITATION_HEADERS);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/buddy/invites/accept-token") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    const relationship = await focusBuddyService(this).acceptInviteByToken(
      auth.userId, requireStringField(asBody(routeRequest), "token"),
    );
    await new LegacyBuddyInvitationAdapter(this.database).syncTerminal(
      "focus", String(relationship.source_invite_id ?? ""), "accepted", auth.userId,
    );
    return frogSleepOk(this, relationship, routeRequest.requestId as string, LEGACY_INVITATION_HEADERS);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/relationships/current") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      dualResourcePayload("relationship", await focusBuddyService(this).currentRelationship(auth.userId)),
      routeRequest.requestId as string,
    );
  }
  const focusRelationshipActionMatch = routeRequest.path.match(/^\/v1\/focus\/relationships\/([^/]+)\/(accept|decline|revoke)$/);
  if (routeRequest.method === "POST" && focusRelationshipActionMatch) {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).relationshipAction(
      auth.userId,
      decodeURIComponent(focusRelationshipActionMatch[1] as string),
      decodeURIComponent(focusRelationshipActionMatch[2] as string),
    ), routeRequest.requestId as string);
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/focus/buddy/messages") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).sendMessage(auth.userId, asBody(routeRequest)), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/buddy/messages") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      await focusBuddyService(this).messages(auth.userId, parsePaginationParams(routeRequest.query), {
        buddyUserId: routeRequest.query?.receiver_user_id ?? routeRequest.query?.receiverUserId,
        since: routeRequest.query?.since,
      }),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/buddy/presence") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await focusBuddyService(this).presence(
      auth.userId,
      routeRequest.query?.buddy_user_id ?? routeRequest.query?.buddyUserId ?? "",
    ), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/buddy/comparison") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      dualResourcePayload("comparison", await focusBuddyService(this).comparison(auth.userId, routeRequest.query?.week_start ?? routeRequest.query?.weekStart)),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/focus/buddy/shared") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      await focusBuddyService(this).sharedMoments(auth.userId, parsePaginationParams(routeRequest.query), {
        roomId: routeRequest.query?.room_id ?? routeRequest.query?.roomId,
        from: routeRequest.query?.from,
        to: routeRequest.query?.to,
      }),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "POST" && routeRequest.path === "/v1/product-data/sleep-reports") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(this, await productDataService(this).createSleepReport(auth.userId, asBody(routeRequest)), routeRequest.requestId as string);
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/product-data/sleep-reports") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      await productDataService(this).listSleepReports(auth.userId, parsePaginationParams(routeRequest.query)),
      routeRequest.requestId as string,
    );
  }
  const productProgressMatch = routeRequest.path.match(/^\/v1\/product-data\/progress\/([^/]+)$/);
  if ((routeRequest.method === "PUT" || routeRequest.method === "PATCH") && productProgressMatch) {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      await productDataService(this).upsertProgress(auth.userId, decodeURIComponent(productProgressMatch[1] as string), asBody(routeRequest)),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "GET" && productProgressMatch) {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      dualResourcePayload("progress", await productDataService(this).getProgress(auth.userId, decodeURIComponent(productProgressMatch[1] as string))),
      routeRequest.requestId as string,
    );
  }
  if (routeRequest.method === "GET" && routeRequest.path === "/v1/product-data/entitlements/current") {
    const auth = await authenticateFrogSleepRequest(this, routeRequest);
    return frogSleepOk(
      this,
      dualResourcePayload("entitlement", await productDataService(this).currentEntitlement(auth.userId)),
      routeRequest.requestId as string,
    );
  }

  return undefined;
}

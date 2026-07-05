import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { FROGSLEEP_APP_ID } from "../modules/frogsleep/frogsleep-app.ts";
import { FrogSleepFocusBuddyService } from "../modules/frogsleep/focus-buddy/focus-buddy.service.ts";
import { emitFrogSleepAnalyticsEvent } from "../modules/frogsleep/frogsleep-analytics.ts";
import {
  asBody,
  authenticateFrogSleepRequest,
  dualResourcePayload,
  frogSleepOk,
  getFrogSleepInviteLinks,
  redirectTo,
  requireStringField,
} from "./frogsleep-v1-common.ts";
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

const FROGSLEEP_V1_PREFIX = "/v1/";

export function isFrogSleepV1Path(path: string): boolean {
  return path === "/v1" || path.startsWith(FROGSLEEP_V1_PREFIX);
}


function focusBuddyService(context: BackendRouteContext): FrogSleepFocusBuddyService {
  return new FrogSleepFocusBuddyService(context.database, context.notificationService);
}


export async function tryHandleFrogSleepV1Routes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!isFrogSleepV1Path(request.path)) {
    if (request.method === "GET" && request.path === "/frogsleep/sleep-buddy-invite") {
      const token = request.query?.token ?? "";
      const code = request.query?.code ?? "";
      return redirectTo(
        `frogsleep://sleep-buddy-invite?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
        request.requestId as string,
      );
    }
    if (request.method === "GET" && request.path === "/frogsleep/focus-invite") {
      const token = request.query?.token ?? "";
      const code = request.query?.code ?? "";
      return redirectTo(
        `frogsleep://focus-invite?token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
        request.requestId as string,
      );
    }
    return undefined;
  }

  if (request.method === "POST" && request.path === "/v1/auth/email/send-code") {
    return await handleFrogSleepEmailCode(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/auth-code") {
    return await handleFrogSleepEmailCode(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/change-code") {
    return await handleFrogSleepEmailChangeCode(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/verify") {
    return await handleFrogSleepEmailLogin(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/login") {
    return await handleFrogSleepEmailLogin(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/complete") {
    return await handleFrogSleepEmailLogin(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/register") {
    return await handleFrogSleepPasswordRegister(this, request, { sendCodeWhenMissing: true });
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/bind") {
    return await handleFrogSleepEmailBindOrChange(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/email/change") {
    return await handleFrogSleepEmailBindOrChange(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/password/register") {
    return await handleFrogSleepPasswordRegister(this, request, { sendCodeWhenMissing: true });
  }
  if (request.method === "POST" && request.path === "/v1/auth/password/login") {
    return await handleFrogSleepPasswordLogin(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/password/reset/request") {
    return await handleFrogSleepPasswordResetRequest(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/password/reset/confirm") {
    return await handleFrogSleepPasswordResetConfirm(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/password/change") {
    return await handleFrogSleepChangePassword(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/token/refresh") {
    return await handleFrogSleepRefresh(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/auth/logout") {
    return await handleFrogSleepLogout(this, request);
  }
  if (request.method === "GET" && request.path === "/v1/me") {
    return await handleFrogSleepMe(this, request);
  }
  if (request.method === "DELETE" && request.path === "/v1/me/account") {
    return await handleFrogSleepDeleteAccount(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/me/devices") {
    return await handleFrogSleepRegisterDevice(this, request);
  }
  const deleteDeviceMatch = request.path.match(/^\/v1\/me\/devices\/([^/]+)$/);
  if (request.method === "DELETE" && deleteDeviceMatch) {
    return await handleFrogSleepDeleteDevice(this, request, decodeURIComponent(deleteDeviceMatch[1] as string));
  }
  if (request.method === "POST" && request.path === "/v1/relationships/invites") {
    return await handleSleepInviteCreate(this, request);
  }
  if (request.method === "GET" && request.path === "/v1/relationships/invites/pending") {
    return await handleSleepPendingInvites(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/relationships/invites/accept-code") {
    return await handleSleepInviteAcceptCode(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/relationships/invites/accept-token") {
    return await handleSleepInviteAcceptToken(this, request);
  }
  const inviteActionMatch = request.path.match(/^\/v1\/relationships\/invites\/([^/]+)\/(accept|decline|cancel)$/);
  if (request.method === "POST" && inviteActionMatch) {
    return await handleSleepInviteAction(
      this,
      request,
      decodeURIComponent(inviteActionMatch[1] as string),
      inviteActionMatch[2] as "accept" | "decline" | "cancel",
    );
  }
  if (request.method === "GET" && request.path === "/v1/relationships/current") {
    return await handleSleepCurrentRelationship(this, request);
  }
  const relationshipActionMatch = request.path.match(/^\/v1\/relationships\/([^/]+)\/(pause|resume|revoke)$/);
  if (request.method === "POST" && relationshipActionMatch) {
    return await handleSleepRelationshipAction(
      this,
      request,
      decodeURIComponent(relationshipActionMatch[1] as string),
      relationshipActionMatch[2] as "pause" | "resume" | "revoke",
    );
  }
  const preferenceMatch = request.path.match(/^\/v1\/relationships\/([^/]+)\/preferences$/);
  if (request.method === "PATCH" && preferenceMatch) {
    return await handleSleepPreferenceUpdate(this, request, decodeURIComponent(preferenceMatch[1] as string));
  }
  if (request.method === "GET" && request.path === "/v1/shared-guardianship/status") {
    return await handleSleepRelationshipStatus(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/shared-sessions") {
    return await handleSleepSessionBegin(this, request);
  }
  if (request.method === "GET" && request.path === "/v1/shared-sessions/active") {
    return await handleSleepActiveSession(this, request);
  }
  const sessionActionMatch = request.path.match(/^\/v1\/shared-sessions\/([^/]+)\/(accept|events|pause-tonight)$/);
  if (request.method === "POST" && sessionActionMatch) {
    const sessionId = decodeURIComponent(sessionActionMatch[1] as string);
    const action = sessionActionMatch[2];
    if (action === "accept") {
      return await handleSleepSessionAccept(this, request, sessionId);
    }
    if (action === "events") {
      return await handleSleepSessionEvent(this, request, sessionId);
    }
    return await handleSleepPauseTonight(this, request, sessionId);
  }
  if (request.method === "GET" && request.path === "/v1/shared-summaries/latest") {
    return await handleSleepLatestSummary(this, request);
  }
  if (request.method === "GET" && request.path === "/v1/shared-recaps/latest") {
    return await handleSleepLatestRecap(this, request);
  }
  if (request.method === "POST" && request.path === "/v1/focus/sessions") {
    const auth = await authenticateFrogSleepRequest(this, request);
    const result = await focusBuddyService(this).reportSession(auth.userId, asBody(request));
    emitFrogSleepAnalyticsEvent(
      { analyticsService: this.analyticsService },
      { name: "frogsleep_focus_session_reported", appId: FROGSLEEP_APP_ID, userId: auth.userId, metadata: { session_id: result.id } },
    );
    return frogSleepOk(this, result, request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/sessions") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, {
      sessions: await focusBuddyService(this).sessions(auth.userId, request.query?.from, request.query?.to),
    }, request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/stats/week") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).weekStats(auth.userId), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/achievements") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, { achievements: await focusBuddyService(this).achievements(auth.userId) }, request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/achievements/notify") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, dualResourcePayload(
      "achievement",
      await focusBuddyService(this).notifyAchievement(
        auth.userId,
        requireStringField(asBody(request), "milestone_id", "milestoneId"),
      ),
    ), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/match-profile") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).saveProfile(auth.userId, asBody(request)), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/match-profile/me") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(
      this,
      dualResourcePayload("profile", await focusBuddyService(this).getProfile(auth.userId)),
      request.requestId as string,
    );
  }
  if (request.method === "DELETE" && request.path === "/v1/focus/match-profile") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).deleteProfile(auth.userId), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/matches/search") {
    const auth = await authenticateFrogSleepRequest(this, request);
    const limit = Number(asBody(request).limit ?? 20);
    return frogSleepOk(this, await focusBuddyService(this).searchMatches(auth.userId, limit), request.requestId as string);
  }
  const focusInviteMatch = request.path.match(/^\/v1\/focus\/matches\/([^/]+)\/invite$/);
  if (request.method === "POST" && focusInviteMatch) {
    const auth = await authenticateFrogSleepRequest(this, request);
    const inviteLinks = await getFrogSleepInviteLinks(this);
    return frogSleepOk(this, await focusBuddyService(this).invite(
      auth.userId,
      decodeURIComponent(focusInviteMatch[1] as string),
      inviteLinks.focusBuddyBaseUrl,
    ), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/buddy/invites") {
    const auth = await authenticateFrogSleepRequest(this, request);
    const body = asBody(request);
    const inviteLinks = await getFrogSleepInviteLinks(this);
    return frogSleepOk(this, await focusBuddyService(this).invite(
      auth.userId,
      requireStringField(body, "target", "email", "user_id", "userId"),
      inviteLinks.focusBuddyBaseUrl,
    ), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/buddy/invites/accept-code") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).acceptInviteByCode(auth.userId, requireStringField(asBody(request), "code")), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/buddy/invites/accept-token") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).acceptInviteByToken(auth.userId, requireStringField(asBody(request), "token")), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/relationships/current") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(
      this,
      dualResourcePayload("relationship", await focusBuddyService(this).currentRelationship(auth.userId)),
      request.requestId as string,
    );
  }
  const focusRelationshipActionMatch = request.path.match(/^\/v1\/focus\/relationships\/([^/]+)\/(accept|decline|revoke)$/);
  if (request.method === "POST" && focusRelationshipActionMatch) {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).relationshipAction(
      auth.userId,
      decodeURIComponent(focusRelationshipActionMatch[1] as string),
      decodeURIComponent(focusRelationshipActionMatch[2] as string),
    ), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/focus/buddy/messages") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).sendMessage(auth.userId, asBody(request)), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/buddy/messages") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, { messages: await focusBuddyService(this).messages(auth.userId) }, request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/buddy/presence") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, await focusBuddyService(this).presence(
      auth.userId,
      request.query?.buddy_user_id ?? request.query?.buddyUserId ?? "",
    ), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/focus/buddy/comparison") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(
      this,
      dualResourcePayload("comparison", await focusBuddyService(this).comparison(auth.userId)),
      request.requestId as string,
    );
  }
  if (request.method === "GET" && request.path === "/v1/focus/buddy/shared") {
    const auth = await authenticateFrogSleepRequest(this, request);
    return frogSleepOk(this, { moments: await focusBuddyService(this).sharedMoments(auth.userId) }, request.requestId as string);
  }

  return undefined;
}

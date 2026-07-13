import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { BuddyInvitationBundleService } from "../modules/frogsleep/buddy-growth/buddy-invitation-bundle.service.ts";
import { BuddyInvitationService } from "../modules/frogsleep/buddy-growth/buddy-invitation.service.ts";
import { BuddyConsentService } from "../modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { BuddyNotificationService } from "../modules/frogsleep/buddy-growth/buddy-notification.service.ts";
import { BuddyGrowthHubService } from "../modules/frogsleep/buddy-growth/buddy-growth-hub.service.ts";
import { BuddyJointGoalService } from "../modules/frogsleep/buddy-growth/buddy-joint-goal.service.ts";
import { BuddyMilestoneReportService } from "../modules/frogsleep/buddy-growth/buddy-milestone-report.service.ts";
import { resolveBuddyGrowthCapabilities } from "../modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import {
  BuddyNotificationPreferenceService,
  buddyNotificationPreferencesPayload,
} from "../modules/frogsleep/buddy-growth/buddy-notification-preference.service.ts";
import { FROGSLEEP_APP_ID } from "../modules/frogsleep/frogsleep-app.ts";
import { badRequest } from "../shared/errors.ts";
import { parsePaginationParams } from "../modules/frogsleep/frogsleep-validation.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk, getFrogSleepInviteLinks, requireStringField } from "./frogsleep-v1-common.ts";

/** Creates a unified single-domain or bundled buddy invitation. */
export async function handleBuddyInvitationCreate(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const links = await getFrogSleepInviteLinks(context);
  const invitation = await new BuddyInvitationBundleService(context.database, context.notificationService).create({
    inviterUserId: auth.userId,
    target: requireStringField(body, "target", "invitee", "email", "user_id", "userId"),
    domains: Array.isArray(body.domains) ? body.domains.map(String) : [],
    sleepInviteBaseUrl: links.sleepBuddyBaseUrl,
    focusInviteBaseUrl: links.focusBuddyBaseUrl,
  });
  return frogSleepOk(context, invitation, request.requestId as string);
}

/** Handles canonical unified buddy invitation and consent routes. */
export async function tryHandleBuddyGrowthRoutes(context: BackendRouteContext, request: HttpRequest) {
  const capabilities = resolveBuddyGrowthCapabilities();
  const notificationResponse = capabilities.invitationInbox
    ? await tryHandleBuddyNotificationRoutes(context, request) : undefined;
  if (notificationResponse) return notificationResponse;
  const growthResponse = await tryHandleBuddyHubRoutes(context, request, capabilities);
  if (growthResponse) return growthResponse;
  if (!capabilities.invitationInbox) return undefined;
  if (request.method === "POST" && request.path === "/v1/buddy/invitations") {
    return await handleBuddyInvitationCreate(context, request);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/invitations") {
    return await listInvitations(context, request);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/invitations/preview") {
    const auth = await authenticateFrogSleepRequest(context, request);
    return frogSleepOk(context, await new BuddyInvitationService(context.database).preview(auth.userId, {
      invitationId: request.query?.invitation_id ?? request.query?.invitationId,
      token: request.query?.token, code: request.query?.code,
      notificationId: request.query?.notification_id ?? request.query?.notificationId,
    }), request.requestId as string);
  }
  const previewMatch = request.path.match(/^\/v1\/buddy\/invitations\/([^/]+)$/);
  if (request.method === "GET" && previewMatch) return await previewInvitation(context, request, previewMatch[1] as string);
  const responseMatch = request.path.match(/^\/v1\/buddy\/invitations\/([^/]+)\/(accept|decline|cancel)$/);
  if (request.method === "POST" && responseMatch) {
    const action = responseMatch[2] as "accept" | "decline" | "cancel";
    if (action === "accept" && !capabilities.explicitInviteConsent) return undefined;
    return await respondInvitation(context, request, responseMatch[1] as string, action);
  }
  const grantsMatch = request.path.match(/^\/v1\/buddy\/relationships\/([^/]+)\/grants$/);
  if (capabilities.explicitInviteConsent && request.method === "GET" && grantsMatch) {
    const auth = await authenticateFrogSleepRequest(context, request);
    return frogSleepOk(context, await new BuddyConsentService(context.database).list(auth.userId,
      decodeURIComponent(grantsMatch[1] as string)), request.requestId as string);
  }
  const grantMatch = request.path.match(/^\/v1\/buddy\/relationships\/([^/]+)\/grants\/([^/]+)$/);
  if (capabilities.explicitInviteConsent && request.method === "PATCH" && grantMatch) {
    return await updateGrant(context, request, grantMatch);
  }
  return undefined;
}

async function tryHandleBuddyHubRoutes(
  context: BackendRouteContext,
  request: HttpRequest,
  capabilities: ReturnType<typeof resolveBuddyGrowthCapabilities>,
) {
  if (!request.path.startsWith("/v1/buddy/")) return undefined;
  const isGrowthHubRoute = request.path === "/v1/buddy/hub" || request.path === "/v1/buddy/activity";
  const isInteractionRoute = ["/v1/buddy/shares", "/v1/buddy/interactions", "/v1/buddy/joint-activities"]
    .some((path) => request.path === path || request.path.startsWith(`${path}/`));
  const isGoalReportRoute = ["/v1/buddy/goals", "/v1/buddy/milestones", "/v1/buddy/weekly-reports"]
    .some((path) => request.path === path || request.path.startsWith(`${path}/`));
  if ((isGrowthHubRoute && !capabilities.growthHub)
    || (isInteractionRoute && !capabilities.structuredInteractions)
    || (isGoalReportRoute && !capabilities.goalsAndReports)) return undefined;
  if (!isGrowthHubRoute && !isInteractionRoute && !isGoalReportRoute) return undefined;
  const auth = await authenticateFrogSleepRequest(context, request);
  const service = new BuddyGrowthHubService(context.database);
  const goalService = new BuddyJointGoalService(context.database);
  const reportService = new BuddyMilestoneReportService(context.database);
  if (request.method === "GET" && request.path === "/v1/buddy/hub") {
    return frogSleepOk(context, await service.snapshot(auth.userId), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/activity") {
    const pagination = parsePaginationParams(request.query);
    return frogSleepOk(context, await service.activity(auth.userId, pagination.limit, request.query?.cursor),
      request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/buddy/shares") {
    return frogSleepOk(context, await service.createShare(auth.userId, asBody(request)), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/buddy/interactions") {
    return frogSleepOk(context, await service.react(auth.userId, asBody(request)), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/buddy/joint-activities") {
    return frogSleepOk(context, await service.createJointActivity(auth.userId, asBody(request)), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/goals") {
    return frogSleepOk(context, await goalService.list(auth.userId, request.query?.relationship_id), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/buddy/goals") {
    return frogSleepOk(context, await goalService.create(auth.userId, asBody(request)), request.requestId as string);
  }
  const goalAction = request.path.match(/^\/v1\/buddy\/goals\/([^/]+)\/(accept|adjust|pause|complete)$/);
  if (request.method === "POST" && goalAction) {
    return frogSleepOk(context, await goalService.act(auth.userId, decodeURIComponent(goalAction[1] as string),
      goalAction[2] as "accept" | "adjust" | "pause" | "complete", asBody(request)), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/milestones") {
    return frogSleepOk(context, await reportService.listMilestones(auth.userId, request.query?.relationship_id),
      request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/weekly-reports") {
    return frogSleepOk(context, await reportService.listReports(auth.userId, request.query?.relationship_id),
      request.requestId as string);
  }
  const reportMatch = request.path.match(/^\/v1\/buddy\/weekly-reports\/([^/]+)$/);
  if (request.method === "GET" && reportMatch) {
    return frogSleepOk(context, await reportService.report(auth.userId, decodeURIComponent(reportMatch[1] as string)),
      request.requestId as string);
  }
  const action = request.path.match(/^\/v1\/buddy\/joint-activities\/([^/]+)\/(accept|decline|cancel|complete)$/);
  if (request.method === "POST" && action) {
    return frogSleepOk(context, await service.jointActivityAction(auth.userId,
      decodeURIComponent(action[1] as string), action[2] as string), request.requestId as string);
  }
  return undefined;
}

async function tryHandleBuddyNotificationRoutes(context: BackendRouteContext, request: HttpRequest) {
  if (!request.path.startsWith("/v1/buddy/notifications")) return undefined;
  const auth = await authenticateFrogSleepRequest(context, request);
  const service = new BuddyNotificationService(context.database);
  const preferenceService = new BuddyNotificationPreferenceService(context.database);
  if (request.path === "/v1/buddy/notifications/preferences") {
    if (request.method === "GET") {
      return frogSleepOk(context, buddyNotificationPreferencesPayload(await preferenceService.get(auth.userId)),
        request.requestId as string);
    }
    if (request.method === "PATCH") {
      return frogSleepOk(context, buddyNotificationPreferencesPayload(
        await preferenceService.update(auth.userId, asBody(request))), request.requestId as string);
    }
  }
  if (request.method === "GET" && request.path === "/v1/buddy/notifications") {
    const pagination = parsePaginationParams(request.query);
    return frogSleepOk(context, await service.list(auth.userId, pagination.limit, request.query?.cursor), request.requestId as string);
  }
  if (request.method === "GET" && request.path === "/v1/buddy/notifications/unread-count") {
    return frogSleepOk(context, await service.unreadCount(auth.userId), request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/buddy/notifications/mark-all-read") {
    return frogSleepOk(context, await service.markAllRead(auth.userId), request.requestId as string);
  }
  const match = request.path.match(/^\/v1\/buddy\/notifications\/([^/]+)\/(read|route)$/);
  if (match && request.method === (match[2] === "read" ? "POST" : "GET")) {
    const id = decodeURIComponent(match[1] as string);
    const data = match[2] === "read" ? await service.markRead(auth.userId, id) : await service.resolve(auth.userId, id);
    return frogSleepOk(context, data, request.requestId as string);
  }
  return undefined;
}

async function listInvitations(context: BackendRouteContext, request: HttpRequest) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const direction = request.query?.direction === "outgoing" ? "outgoing" : "incoming";
  const limit = parsePaginationParams(request.query).limit;
  const page = await new BuddyInvitationService(context.database).list(auth.userId, direction, limit, request.query?.cursor);
  const bundles = await new BuddyInvitationBundleService(context.database, context.notificationService).list(auth.userId, direction);
  const invitations = [...page.invitations, ...bundles]
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))
    .filter((item) => !request.query?.cursor || `${String(item.created_at)}|${String(item.invitation_id)}` < request.query.cursor)
    .slice(0, limit);
  const last = invitations.at(-1);
  return frogSleepOk(context, { invitations, next_cursor: invitations.length === limit && last
    ? `${String(last.created_at)}|${String(last.invitation_id)}` : undefined }, request.requestId as string);
}

async function previewInvitation(context: BackendRouteContext, request: HttpRequest, rawId: string) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const invitationId = decodeURIComponent(rawId);
  const bundle = await context.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, invitationId);
  const data = bundle
    ? await new BuddyInvitationBundleService(context.database, context.notificationService).preview(auth.userId, invitationId)
    : await new BuddyInvitationService(context.database).previewById(auth.userId, invitationId);
  return frogSleepOk(context, data, request.requestId as string);
}

async function respondInvitation(
  context: BackendRouteContext, request: HttpRequest, rawId: string,
  action: "accept" | "decline" | "cancel",
) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const expectedVersion = Number(body.expected_version ?? body.expectedVersion);
  const idempotencyKey = String(body.idempotency_key ?? body.idempotencyKey ?? request.requestId ?? "");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !idempotencyKey) {
    badRequest("REQ_INVALID_BODY", "Invalid buddy invitation response version or idempotency key.");
  }
  const invitationId = decodeURIComponent(rawId);
  const input = { expectedVersion, idempotencyKey,
    sharingCategories: Array.isArray(body.sharing_categories) ? body.sharing_categories.map(String) : undefined };
  const bundle = await context.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, invitationId);
  const data = bundle
    ? await new BuddyInvitationBundleService(context.database, context.notificationService).respond(auth.userId, invitationId, action, input)
    : await new BuddyInvitationService(context.database).respond(auth.userId, invitationId, action, input);
  return frogSleepOk(context, data, request.requestId as string);
}

async function updateGrant(context: BackendRouteContext, request: HttpRequest, match: RegExpMatchArray) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const data = await new BuddyConsentService(context.database).update(auth.userId,
    decodeURIComponent(match[1] as string), decodeURIComponent(match[2] as string),
    Number(body.expected_version ?? body.expectedVersion), String(body.state ?? ""));
  return frogSleepOk(context, data, request.requestId as string);
}

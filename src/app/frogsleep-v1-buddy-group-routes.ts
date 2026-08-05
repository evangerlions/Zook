import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { BuddyGroupService } from "../modules/frogsleep/buddy-growth/buddy-group.service.ts";
import { resolveBuddyGrowthCapabilities } from "../modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";

const GROUP_PATH = "/v1/buddy/groups";

/** Handles /v1/buddy/groups* routes gated by the groupBuddies capability. */
export async function tryHandleBuddyGroupRoutes(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(GROUP_PATH) && request.path !== "/v1/buddy/invitations/accept-group") {
    return undefined;
  }
  const capabilities = resolveBuddyGrowthCapabilities();
  if (!capabilities.groupBuddies) return undefined;
  const auth = await authenticateFrogSleepRequest(context, request);
  const service = new BuddyGroupService(context.database, context.kvManager);

  if (request.method === "POST" && request.path === GROUP_PATH) {
    return frogSleepOk(context, await service.create(auth.userId, asBody(request)), request.requestId as string);
  }
  if (request.method === "GET" && request.path === GROUP_PATH) {
    return frogSleepOk(context, await service.list(auth.userId), request.requestId as string);
  }
  const detailMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) {
    return frogSleepOk(context, await service.get(auth.userId, decodeURIComponent(detailMatch[1] as string)),
      request.requestId as string);
  }
  if (request.method === "PATCH" && detailMatch) {
    return frogSleepOk(context, await service.update(auth.userId, decodeURIComponent(detailMatch[1] as string),
      asBody(request)), request.requestId as string);
  }
  const hubMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)\/hub$/);
  if (request.method === "GET" && hubMatch) {
    return frogSleepOk(context, await service.hub(auth.userId, decodeURIComponent(hubMatch[1] as string)),
      request.requestId as string);
  }
  const invitesMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)\/invitations$/);
  if (request.method === "POST" && invitesMatch) {
    return frogSleepOk(context, await service.invite(auth.userId, decodeURIComponent(invitesMatch[1] as string),
      asBody(request)), request.requestId as string);
  }
  if (request.method === "GET" && invitesMatch) {
    const group = await service.get(auth.userId, decodeURIComponent(invitesMatch[1] as string));
    return frogSleepOk(context, { invitations: group.invitations }, request.requestId as string);
  }
  const invitationAction = request.path.match(/^\/v1\/buddy\/groups\/invitations\/([^/]+)\/(accept|decline|cancel)$/);
  if (request.method === "POST" && invitationAction) {
    const action = invitationAction[2] as "accept" | "decline" | "cancel";
    return frogSleepOk(context, await service.respondInvitation(auth.userId,
      decodeURIComponent(invitationAction[1] as string), action), request.requestId as string);
  }
  const memberMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)\/members\/([^/]+)$/);
  if (request.method === "POST" && memberMatch) {
    return frogSleepOk(context, await service.removeMember(auth.userId,
      decodeURIComponent(memberMatch[1] as string), decodeURIComponent(memberMatch[2] as string)),
      request.requestId as string);
  }
  const roleMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)\/members\/([^/]+)\/role$/);
  if (request.method === "PATCH" && roleMatch) {
    return frogSleepOk(context, await service.changeRole(auth.userId,
      decodeURIComponent(roleMatch[1] as string), decodeURIComponent(roleMatch[2] as string), asBody(request)),
      request.requestId as string);
  }
  const actionMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)\/(leave|pause|resume|dissolve)$/);
  if (request.method === "POST" && actionMatch) {
    const action = actionMatch[2] as "leave" | "pause" | "resume" | "dissolve";
    const data = action === "leave"
      ? await service.leave(auth.userId, decodeURIComponent(actionMatch[1] as string))
      : action === "pause"
        ? await service.pause(auth.userId, decodeURIComponent(actionMatch[1] as string))
        : action === "resume"
          ? await service.resume(auth.userId, decodeURIComponent(actionMatch[1] as string))
          : await service.dissolve(auth.userId, decodeURIComponent(actionMatch[1] as string));
    return frogSleepOk(context, data, request.requestId as string);
  }
  const grantsMatch = request.path.match(/^\/v1\/buddy\/groups\/([^/]+)\/grants$/);
  if (request.method === "GET" && grantsMatch) {
    return frogSleepOk(context, await service.grants(auth.userId, decodeURIComponent(grantsMatch[1] as string)),
      request.requestId as string);
  }
  if (request.method === "POST" && request.path === "/v1/buddy/invitations/accept-group") {
    const body = asBody(request);
    return frogSleepOk(context, await service.acceptByLocator(auth.userId, {
      invitationId: String(body.invitation_id ?? body.invitationId ?? ""),
    }), request.requestId as string);
  }
  return undefined;
}

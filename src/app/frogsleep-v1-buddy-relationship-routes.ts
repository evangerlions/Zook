import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { BuddyRelationshipLifecycleService, type BuddyRelationshipAction } from "../modules/frogsleep/buddy-growth/buddy-relationship-lifecycle.service.ts";
import { BuddyConsentService } from "../modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";
import { badRequest } from "../shared/errors.ts";

/** Exposes versioned relationship safety and directional grants independently of discovery flags. */
export async function tryHandleBuddyRelationshipRoutes(context: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const match = request.path.match(/^\/v1\/buddy\/relationships(?:\/([^/]+))?(?:\/(pause|resume|revoke|mute|unmute|grants))?(?:\/([^/]+))?$/);
  if (!match) return undefined;
  const [, encodedId, action, encodedGrant] = match;
  if (!["GET", "POST", "PUT", "PATCH"].includes(request.method)) return undefined;
  const auth = await authenticateFrogSleepRequest(context, request);
  const id = encodedId ? decodeURIComponent(encodedId) : undefined;
  const service = new BuddyRelationshipLifecycleService(context.database);
  const consent = new BuddyConsentService(context.database, context.kvManager);
  let data: unknown;
  if (request.method === "GET" && !action) data = id ? await service.detail(auth.userId, id) : await service.list(auth.userId);
  else if (id && action === "grants") data = await handleGrants(consent, auth.userId, id, encodedGrant, request);
  else if (id && action && request.method === "POST" && !encodedGrant) {
    if (!PublicContractValidator.validateBuddyRelationshipCommand(asBody(request)).ok) badRequest("REQ_INVALID_BODY", "Invalid relationship command.");
    const version = asBody(request).expected_version;
    if (typeof version !== "number") badRequest("REQ_INVALID_BODY", "Expected relationship version is required.");
    data = await service.execute(auth.userId, id, action as BuddyRelationshipAction, version);
  } else return undefined;
  return data === undefined ? undefined : frogSleepOk(context, data, request.requestId as string);
}

async function handleGrants(service: BuddyConsentService, actor: string, id: string, grant: string | undefined, request: HttpRequest) {
  if (request.method === "GET" && !grant) return await service.list(actor, id);
  const body = asBody(request);
  if (request.method === "PUT" && !grant) {
    if (!PublicContractValidator.validateBuddySharingSelection(body).ok) badRequest("REQ_INVALID_BODY", "Invalid sharing selection.");
    if (!Array.isArray(body.categories) || typeof body.expected_versions !== "object" || !body.expected_versions || Array.isArray(body.expected_versions)) {
      badRequest("REQ_INVALID_BODY", "Categories and expected versions are required.");
    }
    return await service.replaceOwn(actor, id, String(body.domain ?? ""), body.categories.map(String), body.expected_versions as Record<string, number>);
  }
  if (request.method === "PATCH" && grant) return await service.update(actor, id, decodeURIComponent(grant), Number(body.expected_version), String(body.state));
  return undefined;
}

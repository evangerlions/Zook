import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { BuddyDomainInvitationSafetyCommandService } from "../modules/frogsleep/buddy-growth/buddy-domain-invitation-safety-command.service.ts";
import { recordBuddyBlock, revokeBuddyBlock } from "../modules/frogsleep/buddy-growth/buddy-safety.ts";
import { badRequest } from "../shared/errors.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";

const SAFETY_BASELINE_PATH = "/v1/buddy/safety-baseline";

/** Serves versioned, capability-independent safety guarantees for FrogSleep buddy clients. */
export async function tryHandleBuddySafetyRoutes(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const blockMatch = request.path.match(/^\/v1\/buddy\/users\/([^/]+)\/(block|unblock)$/);
  if (request.method === "POST" && blockMatch) {
    return await handleBuddyBlockCommand(context, request, blockMatch);
  }
  const commandMatch = request.path.match(/^\/v1\/buddy\/invitations\/([^/]+)\/domains\/([^/]+)\/(decline|cancel)$/);
  if (request.method === "POST" && commandMatch) return await handleDomainSafetyCommand(context, request, commandMatch);
  if (request.method !== "GET" || request.path !== SAFETY_BASELINE_PATH) return undefined;

  await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(context, {
    schema_version: "1",
    minimum_client_version: "1.0.0",
    server_time: new Date().toISOString(),
    safety_commands: {
      decline: true,
      cancel: true,
      pause: true,
      revoke: true,
      block: true,
    },
  }, request.requestId as string, { "Cache-Control": "private, max-age=300" });
}

async function handleBuddyBlockCommand(context: BackendRouteContext, request: HttpRequest, match: RegExpMatchArray) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const targetUserId = decodeURIComponent(match[1] as string);
  const action = match[2] as "block" | "unblock";
  if (!targetUserId.trim()) badRequest("REQ_INVALID_BODY", "Target user id is required.");
  if (action === "block") {
    const body = asBody(request);
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const note = typeof body.note === "string" ? body.note : undefined;
    const result = await recordBuddyBlock(context.database, auth.userId, targetUserId, { reason, note });
    return frogSleepOk(context, result, request.requestId as string);
  }
  const result = await revokeBuddyBlock(context.database, auth.userId, targetUserId);
  return frogSleepOk(context, result, request.requestId as string);
}

async function handleDomainSafetyCommand(context: BackendRouteContext, request: HttpRequest, match: RegExpMatchArray) {
  const auth = await authenticateFrogSleepRequest(context, request);
  const domain = decodeURIComponent(match[2] as string);
  if (domain !== "sleep" && domain !== "focus") badRequest("REQ_INVALID_BODY", "Invalid buddy invitation domain.");
  const body = asBody(request);
  const expectedVersion = body.expected_version;
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)
    || expectedVersion < 1 || !idempotencyKey.trim()) {
    badRequest("REQ_INVALID_BODY", "Invalid buddy invitation decision version or idempotency key.");
  }
  const data = await new BuddyDomainInvitationSafetyCommandService(context.database).execute(auth.userId,
    decodeURIComponent(match[1] as string), domain, match[3] as "decline" | "cancel", { expectedVersion, idempotencyKey });
  return frogSleepOk(context, data, request.requestId as string);
}

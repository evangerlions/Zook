import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { BuddyDomainInvitationSafetyCommandService } from "../modules/frogsleep/buddy-growth/buddy-domain-invitation-safety-command.service.ts";
import { badRequest } from "../shared/errors.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";

const SAFETY_BASELINE_PATH = "/v1/buddy/safety-baseline";

/** Serves versioned, capability-independent safety guarantees for FrogSleep buddy clients. */
export async function tryHandleBuddySafetyRoutes(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
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

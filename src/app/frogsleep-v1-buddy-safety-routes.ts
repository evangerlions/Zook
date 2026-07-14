import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";

const SAFETY_BASELINE_PATH = "/v1/buddy/safety-baseline";

/** Serves versioned, capability-independent safety guarantees for FrogSleep buddy clients. */
export async function tryHandleBuddySafetyRoutes(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "GET" || request.path !== SAFETY_BASELINE_PATH) {
    return undefined;
  }

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

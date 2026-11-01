import { supportTelemetry, recordSupportTelemetry } from "../modules/frogsleep/buddy-support/buddy-support-telemetry.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest } from "../shared/types.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";
import { BuddySupportCommand } from "../modules/frogsleep/buddy-support/buddy-support-command.ts";
import { BuddySupportQuery } from "../modules/frogsleep/buddy-support/buddy-support-query.ts";
import { supportEnabled, timestamp, unavailable } from "../modules/frogsleep/buddy-support/buddy-support-validation.ts";
import { BuddyRateLimiter } from "../modules/frogsleep/buddy-growth/buddy-rate-limit.ts";

/** Routes authenticated support resources; reads never enroll or consent a relationship. */
export async function tryHandleBuddySupportRoutes(context: BackendRouteContext, request: HttpRequest) {
  const prefix = "/v1/buddy-support";
  if (!request.path.startsWith(`${prefix}/`)) return undefined;
  const auth = await authenticateFrogSleepRequest(context, request);
  const suffix = request.path.slice(prefix.length);
  const headers = { "Cache-Control": "no-store" };
  if (!supportEnabled()) {
    if (request.method === "GET" && suffix === "/center") return frogSleepOk(context,
      { enabled: false, partners: [], next_cursor: null, server_time: timestamp() }, request.requestId!, headers);
    unavailable();
  }
  await new BuddyRateLimiter(context.kvManager).assert("support-http", auth.userId, 120, 60_000);
  const data = await dispatch(context, auth.userId, suffix, request);
  if (data === undefined) unavailable();
  await recordSupportTelemetry(context.analyticsService, auth.userId, supportTelemetry(request.method, suffix, data, asBody(request)));
  return frogSleepOk(context, { ...data, server_time: timestamp() }, request.requestId!, headers);
}

async function dispatch(context: BackendRouteContext, actor: string, path: string, request: HttpRequest) {
  const query = new BuddySupportQuery(context.database);
  const command = new BuddySupportCommand(context.database);
  const body = asBody(request);
  const id = (expression: RegExp) => path.match(expression)?.[1];
  if (request.method === "GET" && path === "/center") return await query.center(actor, request.query ?? {});
  if (request.method === "GET" && path === "/capabilities") return await query.capabilities(actor, String(request.query?.relationship_id ?? ""));
  if (request.method === "GET" && path === "/notes") return await query.history(actor, request.query ?? {});
  if (request.method === "GET" && id(/^\/notes\/([^/]+)$/)) return await query.detail(actor, id(/^\/notes\/([^/]+)$/)!);
  if (request.method === "GET" && id(/^\/operations\/([^/]+)$/)) return await query.operation(actor, id(/^\/operations\/([^/]+)$/)!);
  if (request.method === "POST" && path === "/notes") return await command.send(actor, body);
  if (request.method === "PUT" && id(/^\/permissions\/([^/]+)$/)) return await command.setReceiving(actor, id(/^\/permissions\/([^/]+)$/)!, body);
  if (request.method === "PUT" && id(/^\/operations\/([^/]+)\/resolution$/)) return await command.resolve(actor, id(/^\/operations\/([^/]+)\/resolution$/)!, body);
  if (request.method === "POST" && id(/^\/notes\/([^/]+)\/acknowledgement$/)) return await command.acknowledge(actor, id(/^\/notes\/([^/]+)\/acknowledgement$/)!, body);
}

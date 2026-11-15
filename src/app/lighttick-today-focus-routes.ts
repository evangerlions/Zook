import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { TodayFocusService } from "../modules/lighttick/today-focus/today-focus.service.ts";
import { ApplicationError } from "../shared/errors.ts";
const PREFIX = "/api/v1/lighttick/today/focus";
export async function tryHandleTodayFocusRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  runtime: LightTickRuntime | undefined,
  r: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (r.path !== PREFIX && !r.path.startsWith(PREFIX + "/")) return;
  if (!enabled || !runtime)
    throw new ApplicationError(
      503,
      "LIGHTTICK_APP_DISABLED",
      "LightTick 未开启。",
    );
  const auth = await context.authenticateProductRequest(r, "lighttick");
  await runtime.scopePolicy.assertRequest(r);
  if (await runtime.guestIdentity?.getActive(auth.userId))
    throw new ApplicationError(
      403,
      "APP_SCOPE_FORBIDDEN",
      "今日焦点仅供注册账户使用。",
    );
  const o = { appId: "lighttick" as const, userId: auth.userId },
    service = new TodayFocusService(runtime.repository, runtime.today),
    reply = (data: unknown) =>
      context.ok(data, r.requestId ?? "", { "Cache-Control": "no-store" });
  if (r.path === PREFIX && r.method === "GET")
    return reply(await service.current(o));
  if (r.path === PREFIX && r.method === "PUT") {
    if (
      !r.body ||
      typeof r.body !== "object" ||
      Array.isArray(r.body) ||
      Buffer.byteLength(JSON.stringify(r.body)) > 10000
    )
      throw new ApplicationError(400, "REQ_INVALID_BODY", "焦点请求无效。");
    return reply(await service.select(o, r.body as Record<string, unknown>));
  }
  const match = /^\/requests\/([a-zA-Z0-9_-]{8,160})$/.exec(
    r.path.slice(PREFIX.length),
  );
  if (match && r.method === "GET")
    return reply(await service.byRequest(o, match[1]));
  throw new ApplicationError(
    405,
    "VALIDATION_ERROR",
    "Unsupported today focus method or path.",
  );
}

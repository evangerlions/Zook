import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { FocusService } from "../modules/lighttick/focus/focus.service.ts";
import { ApplicationError } from "../shared/errors.ts";
const PREFIX = "/api/v1/lighttick/focus";
export async function tryHandleLightTickFocusRoutes(
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
      "游客不能使用账户专注计时。",
    );
  const owner = { appId: "lighttick" as const, userId: auth.userId },
    service = new FocusService(runtime.repository, runtime.focus?.clock),
    path = r.path.slice(PREFIX.length),
    body = r.body ?? {};
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApplicationError(400, "REQ_INVALID_BODY", "计时请求必须为对象。");
  const reply = (data: unknown, statusCode = 200) => ({
    ...context.ok(data, r.requestId as string, { "Cache-Control": "no-store" }),
    statusCode,
  });
  if (path === "/current" && r.method === "GET")
    return reply(await service.current(owner));
  if (path === "/preferences" && r.method === "PUT")
    return reply(
      await service.preferences(owner, body as Record<string, unknown>),
    );
  if (path === "/sessions" && r.method === "GET")
    return reply(await service.history(owner, r.query ?? {}));
  if (path === "/sessions" && r.method === "POST")
    return reply(
      await service.start(owner, body as Record<string, unknown>),
      201,
    );
  const request = /^\/requests\/([a-zA-Z0-9_-]{8,160})$/.exec(path);
  if (request && r.method === "GET")
    return reply(await service.byRequest(owner, request[1]!));
  const session =
    /^\/sessions\/(focus_session_[a-f0-9]{40})(?:\/(commands))?$/.exec(path);
  if (session && r.method === "GET" && !session[2])
    return reply(await service.get(owner, session[1]!));
  if (session && r.method === "POST" && session[2])
    return reply(
      await service.command(
        owner,
        session[1]!,
        body as Record<string, unknown>,
      ),
    );
  throw new ApplicationError(405, "VALIDATION_ERROR", "计时路径或方法无效。");
}

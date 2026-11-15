import { DailyRhythmService } from "../modules/lighttick/today-focus/daily-rhythm.service.ts";
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
  if (r.path === PREFIX + "/rhythm") {
    const rhythm = new DailyRhythmService(
      runtime.repository,
      () => new Date(),
      async () => {
        const member = await context.database.findAppUser(o.appId, o.userId),
          user = await context.database.findUserById(o.userId);
        if (member?.status !== "ACTIVE" || user?.status !== "ACTIVE")
          throw new ApplicationError(
            403,
            "APP_SCOPE_FORBIDDEN",
            "Account is unavailable.",
          );
      },
    );
    if (r.method === "GET")
      return reply(
        await rhythm.history(
          o,
          typeof r.query?.date === "string" ? r.query.date : "",
        ),
      );
    if (r.method === "PUT") {
      if (!r.body || Buffer.byteLength(JSON.stringify(r.body)) > 10000)
        throw new ApplicationError(400, "REQ_INVALID_BODY", "节奏请求无效。");
      return reply(await rhythm.command(o, r.body));
    }
  }
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

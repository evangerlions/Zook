import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { BehaviorService } from "../modules/lighttick/behavior/behavior.service.ts";
import { ApplicationError } from "../shared/errors.ts";
const root = "/api/v1/lighttick/behavior-applications";
export async function tryHandleBehaviorRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  runtime: LightTickRuntime | undefined,
  r: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (r.path !== root && !r.path.startsWith(root + "/")) return;
  if (!enabled || !runtime)
    throw new ApplicationError(
      503,
      "LIGHTTICK_APP_DISABLED",
      "LightTick未开启。",
    );
  const authorize = async () => {
      const auth = await context.authenticateProductRequest(r, "lighttick");
      if (await runtime.guestIdentity?.getActive(auth.userId))
        throw new ApplicationError(
          403,
          "APP_SCOPE_FORBIDDEN",
          "请使用注册账户。",
        );
      await runtime.scopePolicy.assertRequest(r);
      return auth;
    },
    auth = await authorize(),
    o = { appId: "lighttick" as const, userId: auth.userId },
    s = new BehaviorService(runtime.repository, undefined, async () => {
      await authorize();
    }),
    path = r.path.slice(root.length),
    reply = (data: unknown) =>
      context.ok(data, r.requestId ?? "", { "Cache-Control": "no-store" });
  if (r.method === "GET") {
    if (path === "") return reply(await s.list(o, r.query ?? {}));
    if (path === "/catalog") return reply(await s.catalog(o));
    if (path === "/concepts") return reply(await s.concepts(o, r.query ?? {}));
    const receipt = /^\/requests\/by-key\/([a-zA-Z0-9_-]{8,160})$/.exec(path);
    if (receipt) return reply(await s.receipt(o, receipt[1]));
    if (/^\/application-[a-zA-Z0-9-]{1,100}$/.test(path))
      return reply(await s.get(o, path.slice(1)));
  }
  const b = r.body ?? {},
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Buffer.byteLength(JSON.stringify(b)) > 16000
  )
    throw new ApplicationError(400, "REQ_INVALID_BODY", "应用记录请求无效。");
  const id = /^\/(application-[a-zA-Z0-9-]{1,100})(?:\/(archive))?$/.exec(path);
  if (id && r.method === "PUT" && !id[2])
    return reply(await s.save(o, id[1], b as Record<string, unknown>, key));
  if (id && r.method === "POST" && id[2])
    return reply(await s.archive(o, id[1], b as Record<string, unknown>, key));
  throw new ApplicationError(405, "VALIDATION_ERROR", "不支持的应用记录操作。");
}

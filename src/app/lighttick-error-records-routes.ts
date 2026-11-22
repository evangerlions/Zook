import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ErrorRecordsService } from "../modules/lighttick/error-records/error-records.service.ts";
import { ApplicationError } from "../shared/errors.ts";
const ROOT = "/api/v1/lighttick/error-records";
export async function tryHandleErrorRecordsRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  runtime: LightTickRuntime | undefined,
  r: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (r.path !== ROOT && !r.path.startsWith(ROOT + "/")) return;
  if (!enabled || !runtime)
    throw new ApplicationError(
      503,
      "LIGHTTICK_APP_DISABLED",
      "LightTick 未开启。",
    );
  const authorize = async () => {
    const a = await context.authenticateProductRequest(r, "lighttick");
    await runtime.scopePolicy.assertRequest(r);
    if (await runtime.guestIdentity?.getActive(a.userId))
      throw new ApplicationError(
        403,
        "APP_SCOPE_FORBIDDEN",
        "错误记录仅供注册账户使用。",
      );
    return a;
  };
  const auth = await authorize(),
    owner = { appId: "lighttick" as const, userId: auth.userId },
    s = new ErrorRecordsService(runtime.repository),
    path = r.path.slice(ROOT.length),
    body = r.body ?? {},
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
    reply = (data: unknown) =>
      context.ok(data, r.requestId ?? "", { "Cache-Control": "no-store" });
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Buffer.byteLength(JSON.stringify(body)) > 16000
  )
    throw new ApplicationError(400, "REQ_INVALID_BODY", "错误记录请求无效。");
  if (r.method === "GET" && path === "")
    return reply(await s.list(owner, r.query ?? {}));
  if (r.method === "GET" && path === "/lookup")
    return reply(await s.lookup(owner, r.query ?? {}));
  if (r.method === "GET" && path === "/catalog")
    return reply(await s.catalog(owner));
  if (r.method === "POST" && path === "/categories")
    return reply(
      await s.createCategory(owner, body as any, key, async () => {
        await authorize();
      }),
    );
  const receipt = /^\/requests\/([a-zA-Z0-9_-]{8,160})$/.exec(path);
  if (receipt && r.method === "GET")
    return reply(await s.receipt(owner, receipt[1]));
  const type = /^\/categories\/(etype-[a-f0-9]{32})$/.exec(path);
  if (type) {
    if (r.method === "PUT")
      return reply(
        await s.category(owner, type[1], body as any, key, async () => {
          await authorize();
        }),
      );
    if (r.method === "DELETE")
      return reply(
        await s.deleteCategory(owner, type[1], body as any, key, async () => {
          await authorize();
        }),
      );
  }
  const match = /^\/(error-[a-zA-Z0-9-]{1,100})(?:\/(archive))?$/.exec(path);
  if (match) {
    if (!match[2] && r.method === "GET")
      return reply(await s.detail(owner, match[1], r.query?.after ?? ""));
    if (!match[2] && r.method === "PUT")
      return reply(
        await s.save(owner, match[1], body as any, key, async () => {
          await authorize();
        }),
      );
    if (match[2] && r.method === "POST")
      return reply(
        await s.archive(owner, match[1], body as any, key, async () => {
          await authorize();
        }),
      );
  }
  throw new ApplicationError(
    405,
    "VALIDATION_ERROR",
    "Unsupported error record method or path.",
  );
}

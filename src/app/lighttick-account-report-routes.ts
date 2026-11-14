import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import { AccountReportService } from "../modules/lighttick/account-reports/account-report.service.ts";
import { ApplicationError } from "../shared/errors.ts";
const PREFIX = "/api/v1/lighttick/account-reports";
export async function tryHandleLightTickAccountReportRoutes(
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
  if (await runtime.guestIdentity?.getActive(auth.userId))
    throw new ApplicationError(
      403,
      "APP_SCOPE_FORBIDDEN",
      "游客不能访问账户报告。",
    );
  const owner = { appId: "lighttick" as const, userId: auth.userId },
    base = runtime.accountReports;
  const service = new AccountReportService(
    runtime.repository,
    base?.queue,
    () => runtime.scopePolicy.assertFull(),
    base?.clock,
    base?.collect,
  );
  const path = r.path.slice(PREFIX.length),
    body = r.body ?? {};
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApplicationError(400, "REQ_INVALID_BODY", "报告请求必须为对象。");
  const reply = (data: unknown, status = 200) => ({
    ...context.ok(data, r.requestId as string, {"Cache-Control":"no-store"}),
    statusCode: status,
  });
  if (!path && r.method === "GET")
    return reply(await service.list(owner, r.query ?? {}));
  if (!path && r.method === "POST")
    return reply(
      await service.create(owner, body as Record<string, unknown>),
      202,
    );
  const request = /^\/requests\/by-key\/([a-zA-Z0-9_-]{8,160})$/.exec(path);
  if (request && r.method === "GET")
    return reply(await service.byRequest(owner, request[1]!));
  const item = /^\/(account_report_[a-f0-9]{40})(?:\/(cancel))?$/.exec(path);
  if (item && r.method === "GET" && !item[2])
    return reply(await service.get(owner, item[1]!));
  if (
    item &&
    ((r.method === "DELETE" && !item[2]) ||
      (r.method === "POST" && item[2] === "cancel"))
  )
    return reply(
      await service.mutate(
        owner,
        item[1]!,
        r.method === "DELETE" ? "delete" : "cancel",
        body as Record<string, unknown>,
      ),
    );
  throw new ApplicationError(405, "VALIDATION_ERROR", "报告路径或方法无效。");
}

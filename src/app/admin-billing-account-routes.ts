import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { strictObject } from "../shared/strict-object.ts";
import { validateBalanceConfig } from "../modules/llm-balances/balance-config.ts";
type Context = Pick<BackendRouteContext, "feishuServices" | "authenticateAdmin" | "recordAdminMutationAudit" | "ok">;
const ROOT = "/api/v1/admin/billing-accounts";
export async function tryHandleAdminBillingAccountRoutes(c: Context, r: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (r.path !== ROOT && !r.path.startsWith(`${ROOT}/`)) return;
  const actor = c.authenticateAdmin(r); const services = c.feishuServices;
  if (!services) throw new ApplicationError(503, "FEISHU_UNCONFIGURED", "Balance services unavailable.");
  const match = r.path.match(/^\/api\/v1\/admin\/billing-accounts\/([\w-]+)\/refresh$/);
  const loginStart = r.path.match(/^\/api\/v1\/admin\/billing-accounts\/([\w-]+)\/login\/(start|clear)$/);
  const loginAction = r.path.match(/^\/api\/v1\/admin\/billing-accounts\/([\w-]+)\/login\/([\w-]+)\/(view|input|read|close)$/);
  let result: unknown, action: string;
  if (r.method === "POST" && loginStart) {
    strictObject(r.body ?? {}, []);
    result = loginStart[2] === "start" ? await services.manualLogins.start(loginStart[1], actor) : await services.manualLogins.clearState(loginStart[1]);
    action = `login_${loginStart[2]}`;
  } else if (r.method === "POST" && loginAction) {
    const operation = loginAction[3] as "view" | "input" | "read" | "close";
    if (operation !== "input") strictObject(r.body ?? {}, []);
    result = await services.manualLogins.operate(loginAction[1], loginAction[2], actor, operation, r.body);
    action = `login_${operation}`;
  } else if (r.method === "GET" && r.path === ROOT) { result = await services.accounts.document(); action = "read"; }
  else if (r.method === "POST" && r.path === ROOT) { result = await services.accounts.store.save(r.body); action = "save"; }
  else if (r.method === "POST" && match) { strictObject(r.body ?? {}, []); result = await services.accounts.refresh(match[1]); action = "refresh"; }
  else if (r.method === "PUT" && r.path === `${ROOT}/config`) {
    const body = strictObject(r.body, ["config", "desc"]); const config = validateBalanceConfig(body.config);
    if (config.rules.length || (body.desc !== undefined && (typeof body.desc !== "string" || body.desc.length > 2000))) throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid global balance settings.");
    result = await services.balanceConfig.save(config, body.desc as string ?? "Update balance settings"); action = "config";
  } else throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Route not found.");
  if (action !== "read") await c.recordAdminMutationAudit({ appId: "common", actorUserId: actor, action: `admin.billing_accounts.${action}`,
    resourceType: "billing_account", resourceId: loginStart?.[1] ?? loginAction?.[1] ?? match?.[1] ?? "accounts", payload: { requestId: r.requestId } });
  return { ...c.ok(result, r.requestId!), headers: { "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer" } };
}

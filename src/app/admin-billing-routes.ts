import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const ROOT = "/api/v1/admin/billing";

export async function tryHandleAdminBillingRoutes(
  this: BackendRouteContext, request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const detail = request.path.match(/^\/api\/v1\/admin\/billing\/orders\/([^/]+)$/);
  const endpoint = request.path.slice(ROOT.length);
  if (request.method !== "GET" || (!detail && !["/apps", "/overview", "/memberships", "/orders"].includes(endpoint))) return undefined;
  if (!request.path.startsWith(`${ROOT}/`)) return undefined;
  const session = this.requireAdminSession(request);
  const query = request.query ?? {};
  let data: unknown;
  if (detail) data = await this.billingAdminService.getOrder(decodeURIComponent(detail[1]!), query);
  else switch (endpoint) {
    case "/apps": data = await this.billingAdminService.listApps(); break;
    case "/overview": data = await this.billingAdminService.overview(query); break;
    case "/memberships": data = await this.billingAdminService.listMemberships(query); break;
    case "/orders": data = await this.billingAdminService.listOrders(query); break;
    default: return undefined;
  }
  await this.recordAdminBillingReadAudit({ adminUser: session.username, appId: query.appId ?? "all",
    action: detail ? "admin.billing.orders.detail" : `admin.billing${endpoint.replaceAll("/", ".")}.list`,
    resourceId: detail ? decodeURIComponent(detail[1]!) : endpoint,
    requestId: request.requestId, filterNames: Object.keys(query).sort() });
  return this.ok(data, request.requestId as string, { "Cache-Control": "no-store" });
}

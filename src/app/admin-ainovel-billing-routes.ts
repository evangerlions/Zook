import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const ORDERS_PATH = "/api/v1/admin/apps/ai_novel/billing/orders";

export async function tryHandleAdminAiNovelBillingRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === ORDERS_PATH) {
    const session = this.requireAdminSession(request);
    const data = await this.aiNovelBillingAdminService.listOrders(request.query ?? {});
    await this.recordAdminBillingReadAudit({
      adminUser: session.username,
      action: "admin.ai_novel_billing.orders.list",
      resourceId: "orders:query",
      requestId: request.requestId,
      filterNames: Object.keys(request.query ?? {}).sort(),
    });
    return this.ok(data, request.requestId as string, { "Cache-Control": "no-store" });
  }

  const detailMatch = request.path.match(/^\/api\/v1\/admin\/apps\/ai_novel\/billing\/orders\/([^/]+)$/);
  if (request.method !== "GET" || !detailMatch) return undefined;

  const session = this.requireAdminSession(request);
  const paymentId = decodeURIComponent(detailMatch[1] as string);
  const data = await this.aiNovelBillingAdminService.getOrder({
    paymentId,
    eventsCursor: request.query?.eventsCursor,
    eventsLimit: request.query?.eventsLimit,
  });
  await this.recordAdminBillingReadAudit({
    adminUser: session.username,
    action: "admin.ai_novel_billing.orders.detail",
    resourceId: paymentId,
    resourceOwnerUserId: data.order.userId,
    requestId: request.requestId,
  });
  return this.ok(data, request.requestId as string, { "Cache-Control": "no-store" });
}

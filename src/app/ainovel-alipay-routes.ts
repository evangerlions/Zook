import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { getHeader } from "../shared/utils.ts";
import { ApplicationError } from "../shared/errors.ts";
import { parseAlipayCreate } from "../modules/billing/alipay-policy.ts";
import { BILLING_BENEFITS_CONFIG_KEY } from "../modules/billing/ainovel-billing-benefits.ts";
import { billingCheckoutDisplay, billingAmountText } from "../modules/billing/ainovel-billing-display.ts";
const ORDERS = "/api/v1/ai_novel/billing/alipay/orders";
const NOTIFY = "/api/v1/ai_novel/billing/webhooks/alipay";
export async function tryHandleAlipayRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (request.path === NOTIFY && request.method === "POST") {
    if (getHeader(request.headers, "content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded")
      throw new ApplicationError(415, "BILLING_NOTIFY_INVALID", "Alipay requires a form notification.");
    const acknowledgement = await this.aiNovelBillingService.alipay.notify(request.body, request.requestId);
    return { statusCode: 200, contentType: "text/plain; charset=utf-8", body: this.ok({ received: true }, request.requestId!).body, rawBody: acknowledgement };
  }
  if (request.path === ORDERS && request.method === "POST") {
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    const region = await this.resolveAccountRegion(request, "ai_novel", auth.userId);
    const input = parseAlipayCreate(request.body);
    // Checkout presentation errors cannot block financial creation or replay.
    const config = await this.database.findAppConfig("ai_novel", BILLING_BENEFITS_CONFIG_KEY);
    const checkoutCopy = billingCheckoutDisplay(input.productKey, this.resolveRequestLocale(request), config?.configValue);
    const result = await this.aiNovelBillingService.alipay.create(auth.userId, region, input, request.requestId);
    return this.ok({ ...result, display: { ...checkoutCopy,
      amountText: billingAmountText(result.order.amountMinor, this.resolveRequestLocale(request)) } }, request.requestId!);
  }
  if (request.path.startsWith(ORDERS + "/") && request.method === "GET") {
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    if (request.body !== undefined) throw new ApplicationError(400, "REQ_INVALID_BODY", "Order query does not accept a body.");
    return this.ok(await this.aiNovelBillingService.alipay.readOrder(auth.userId, request.path.slice(ORDERS.length + 1), request.requestId), request.requestId!);
  }
  return undefined;
}

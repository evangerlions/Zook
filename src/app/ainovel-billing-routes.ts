import { parseMembershipSync } from "../modules/billing/membership-sync.ts";
import { ApplicationError } from "../shared/errors.ts";
import { tryHandleAlipayRoutes } from "./ainovel-alipay-routes.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { getHeader } from "../shared/utils.ts";
import { parseClientAccountRegion } from "../modules/app-registry/account-region.ts";
import { BILLING_BENEFITS_CONFIG_KEY } from "../modules/billing/ainovel-billing-benefits.ts";
import {
  buildAiNovelBillingCatalog,
  isAiNovelBillingChannelSupported,
  type AiNovelBillingCatalogInput,
} from "../modules/billing/ainovel-billing-catalog.ts";

const BILLING_PATH = "/api/v1/ai_novel/billing/catalog";
const BILLING_SYNC_PATH = "/api/v1/ai_novel/billing/sync";
const REVENUECAT_WEBHOOK_PATH = "/api/v1/ai_novel/billing/webhooks/revenuecat";

export async function tryHandleAiNovelBillingRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const alipay = await tryHandleAlipayRoutes.call(this, request);
  if (alipay) return alipay;
  if (request.method === "POST" && request.path === BILLING_SYNC_PATH) {
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    const body = parseMembershipSync(request.body);
    return this.ok(
      await this.aiNovelBillingService.syncMembership({
        userId: auth.userId,
        requestId: request.requestId as string,
        ...body,
        signal: request.signal,
      }),
      request.requestId as string,
    );
  }

  if (request.method === "POST" && request.path === REVENUECAT_WEBHOOK_PATH) {
    const result = await this.aiNovelBillingService.receiveWebhook({
      request,
      requestId: request.requestId as string,
      authorization: getHeader(request.headers, "authorization"),
    });
    return this.ok({ received: true, status: result.status }, request.requestId as string);
  }

  if (request.method !== "GET" || request.path !== BILLING_PATH) {
    return undefined;
  }

  // Only absence permits guest access; invalid supplied credentials still fail.
  const auth = getHeader(request.headers, "authorization") === undefined
    ? undefined : await this.authenticateProductRequest(request, "ai_novel");
  const requestedApp = getHeader(request.headers, "x-app-id");
  if (requestedApp !== undefined && requestedApp !== "ai_novel") {
    throw new ApplicationError(403, "AUTH_APP_SCOPE_MISMATCH", "Requested app scope does not match the catalog.");
  }
  await this.appRegistryService.getAppOrThrow("ai_novel");
  const regionHeader = getHeader(request.headers, "x-app-region");
  const guestRegion = parseClientAccountRegion(regionHeader);
  if (!auth && regionHeader !== undefined && !guestRegion) {
    throw new ApplicationError(400, "REQ_INVALID_QUERY", "X-App-Region must be CN or GLOBAL.");
  }
  const alipayCatalog = await this.aiNovelBillingService.alipay.checkoutCatalog();
  const input: AiNovelBillingCatalogInput = {
    locale: this.resolveRequestLocale(request),
    benefitsConfig: (await this.database.findAppConfig("ai_novel", BILLING_BENEFITS_CONFIG_KEY))?.configValue,
    alipayAvailable: alipayCatalog.available,
    alipayPrices: alipayCatalog.prices,
    accountRegion: auth ? await this.resolveAccountRegion(
      request,
      "ai_novel",
      auth.userId,
    ) : guestRegion ?? "GLOBAL",
    platform: parsePlatform(request.query?.platform),
    distribution: parseDistribution(request.query?.distribution),
  };

  if (!isAiNovelBillingChannelSupported(input)) {
    throw new ApplicationError(
      400,
      "REQ_INVALID_QUERY",
      "platform and distribution are not supported for this account region.",
    );
  }

  const response = this.ok(
    buildAiNovelBillingCatalog(input),
    request.requestId as string,
  );
  response.headers = { ...response.headers, "cache-control": "no-store",
    vary: "Authorization, X-App-Region, X-App-Id, X-App-Locale, Accept-Language" };
  return response;
}

function parsePlatform(
  value: string | undefined,
): AiNovelBillingCatalogInput["platform"] {
  if (
    value === "ios" ||
    value === "android" ||
    value === "macos" ||
    value === "web" ||
    value === "windows"
  ) {
    return value;
  }
  throw new ApplicationError(
    400,
    "REQ_INVALID_QUERY",
    "platform must be a supported billing platform.",
  );
}

function parseDistribution(
  value: string | undefined,
): AiNovelBillingCatalogInput["distribution"] {
  if (
    value === "app_store" ||
    value === "google_play" ||
    value === "china_android_store" ||
    value === "direct_android" ||
    value === "web" ||
    value === "windows"
  ) {
    return value;
  }
  throw new ApplicationError(
    400,
    "REQ_INVALID_QUERY",
    "distribution must be a supported billing distribution.",
  );
}

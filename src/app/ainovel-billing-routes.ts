import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import {
  buildAiNovelBillingCatalog,
  isAiNovelBillingChannelSupported,
  type AiNovelBillingCatalogInput,
} from "../modules/billing/ainovel-billing-catalog.ts";

const BILLING_PATH = "/api/v1/ai_novel/billing/catalog";

export async function tryHandleAiNovelBillingRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "GET" || request.path !== BILLING_PATH) {
    return undefined;
  }

  const auth = await this.authenticateProductRequest(request, "ai_novel");
  const input: AiNovelBillingCatalogInput = {
    accountRegion: await this.resolveAccountRegion(
      request,
      "ai_novel",
      auth.userId,
    ),
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

  return this.ok(
    buildAiNovelBillingCatalog(input),
    request.requestId as string,
  );
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

import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { RevenueCatV2ReadSession } from "./ainovel-revenuecat-read-session.ts";
import { RevenueCatApiError, isObject, type RevenueCatSnapshot } from "./ainovel-revenuecat-types.ts";
import { revenueCatAppForStore } from "../modules/billing/ainovel-store-products.ts";
export { RevenueCatApiError, isObject } from "./ainovel-revenuecat-types.ts";
export interface RevenueCatCustomerApiOptions {
  secretApiKey?: string;
  projectId?: string;
  appId?: string;
  googleAppId?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  logger?: StructuredLogger;
  now?: () => Date;
}
export class RevenueCatCustomerApi {
  private lastObservationMs = 0;
  constructor(private readonly options: RevenueCatCustomerApiOptions) {}
  async getSnapshot(userId: string, requestSignal?: AbortSignal,
    requestId?: string): Promise<RevenueCatSnapshot> {
    const startedAt = performance.now();
    this.lastObservationMs = Math.max((this.options.now?.() ?? new Date()).getTime(), this.lastObservationMs + 1);
    const observedAt = new Date(this.lastObservationMs).toISOString();
    const context = { userId, requestId, appId: "ai_novel", provider: "revenuecat", apiVersion: "v2" };
    const { logger } = this.options;
    logger?.info("ainovel billing revenuecat lookup started", context);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs ?? 8_000);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout.signal]) : timeout.signal;
    try {
      const key = this.options.secretApiKey?.trim();
      const projectId = this.options.projectId?.trim();
      const appId = this.options.appId?.trim();
      if (!key || !projectId || (!appId && !this.options.googleAppId?.trim())) throw new RevenueCatApiError("not_configured");
      const session = new RevenueCatV2ReadSession(projectId, key, this.options.fetcher ?? fetch, signal);
      const root = `/customers/${encodeURIComponent(userId)}`;
      const [subscriptions, activeEntitlements] = await Promise.all([
        session.list(`${root}/subscriptions?limit=100`),
        session.list(`${root}/active_entitlements?limit=100`),
      ]);
      const evidence: RevenueCatSnapshot["subscriptions"] = [];
      for (const subscription of subscriptions) {
        if (subscription.store === "promotional" && subscription.product_id === null) continue;
        if (subscription.customer_id !== userId || typeof subscription.id !== "string" ||
          typeof subscription.product_id !== "string") throw new RevenueCatApiError("invalid_response");
        const product = await session.object(`/products/${encodeURIComponent(subscription.product_id)}`);
        if (product.id !== subscription.product_id || typeof product.app_id !== "string" ||
          typeof product.store_identifier !== "string") throw new RevenueCatApiError("invalid_response");
        const expectedAppId = revenueCatAppForStore(subscription.store, appId, this.options.googleAppId);
        if (!expectedAppId || product.app_id !== expectedAppId) continue;
        const path = `/subscriptions/${encodeURIComponent(subscription.id)}`;
        const entitlements = isObject(subscription.entitlements) &&
          subscription.entitlements.next_page == null
          ? session.items(subscription.entitlements)
          : await session.list(`${path}/entitlements?limit=100`);
        const transactions = await session.list(`${path}/transactions?limit=100`);
        evidence.push({ subscription, product, entitlements, transactions });
      }
      logger?.info("ainovel billing revenuecat lookup completed", {
        ...context, httpStatus: 200, subscriptionCount: evidence.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { subscriptions: evidence, activeEntitlements, observedAt };
    } catch (error) {
      const failure = error instanceof RevenueCatApiError ? error : new RevenueCatApiError("request_failed", {
        failureKind: requestSignal?.aborted ? "request_cancelled" : timeout.signal.aborted ? "timeout" : "network_error",
      });
      logger?.warn("ainovel billing revenuecat lookup failed", {
        ...context, failureReason: failure.reason, ...failure.diagnostics,
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw failure;
    } finally { clearTimeout(timer); }
  }
}

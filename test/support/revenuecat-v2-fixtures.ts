import type { RevenueCatResource } from "../../src/services/ainovel-revenuecat-types.ts";
interface Fixture {
  entitlements: Record<string, RevenueCatResource>;
  subscriptions: Record<string, RevenueCatResource>;
}
export function snapshot(overrides: {
  entitlements?: Record<string, RevenueCatResource>;
  subscriptions?: Record<string, RevenueCatResource>;
} = {}): Fixture {
  return {
    entitlements: overrides.entitlements ?? { orangewrite_plus: {
      productKey: "plus_monthly", expiresAt: "2026-10-23T10:00:00Z", graceExpiresAt: null,
    } },
    subscriptions: overrides.subscriptions ?? { plus_monthly: {
      store: "app_store", transactionId: "tx_plus_001", purchasedAt: "2026-09-23T10:00:00Z",
      originalPurchasedAt: "2026-09-23T10:00:00Z", expiresAt: "2026-10-23T10:00:00Z",
      refundAt: null, cancelledAt: null, sandbox: true,
    } },
  };
}
function list(items: unknown[]) { return { object: "list", items, next_page: null }; }
function ms(value: unknown): number | null {
  return typeof value === "string" ? Date.parse(value) : null;
}
/** Serve real V2 resource shapes from declarative scenario fixtures. */
export function fixtureFetcher(scenario: typeof fetch, appId: string): typeof fetch {
  const reads = new Map<string, Promise<{ response: Response; fixture?: Fixture }>>();
  let current: Fixture | undefined;
  return async (input, init) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/\/customers\/([^/]+)\/(subscriptions|active_entitlements)$/);
    if (match) {
      const userId = decodeURIComponent(match[1]);
      if (match[2] === "subscriptions") reads.set(userId, (async () => {
        const response = await scenario(input, init);
        if (!response.ok) return { response };
        return { response, fixture: await response.json() as Fixture };
      })());
      const pending = reads.get(userId);
      if (!pending) throw new Error("Missing fixture customer read");
      const read = await pending;
      if (!read.fixture) return read.response.clone();
      current = read.fixture;
      if (match[2] === "active_entitlements") return Response.json(list(
        Object.entries(current.entitlements).map(([key,e]) => ({
          object: "customer.active_entitlement", entitlement_id: key,
          expires_at: ms(e.graceExpiresAt) ?? ms(e.expiresAt),
        }))));
      return Response.json(list(Object.entries(current.subscriptions).map(([key,s]) => {
        const entitlements = Object.entries(current!.entitlements).filter(([,e]) => e.productKey === key);
        const grace = entitlements.some(([,e]) => e.graceExpiresAt != null);
        return {
          object: "subscription", id: "sub_"+key, customer_id: userId, product_id: "prod_"+key,
          store: s.store, environment: s.sandbox === true ? "sandbox" : s.sandbox === false ? "production" : undefined,
          gives_access: entitlements.length > 0, status: grace ? "in_grace_period" : entitlements.length ? "active" : "expired",
          auto_renewal_status: s.cancelledAt == null ? "will_renew" : "will_not_renew",
          starts_at: ms(s.originalPurchasedAt), current_period_starts_at: ms(s.purchasedAt),
          current_period_ends_at: ms(s.expiresAt), management_url: "https://apps.apple.com/account/subscriptions",
          entitlements: list(entitlements.map(([id]) => ({ id, lookup_key: id, object: "entitlement" }))),
        };
      })));
    }
    const product = url.pathname.match(/\/products\/prod_(.+)$/);
    if (product) return Response.json({ object: "product", id: "prod_"+product[1], app_id: appId,
      store_identifier: product[1], subscription: { grace_period_duration: "P7D" } });
    const tx = url.pathname.match(/\/subscriptions\/sub_(.+)\/transactions$/);
    if (tx && current) {
      const key = tx[1], s = current.subscriptions[key];
      return Response.json(list(s?.transactionId ? [{
        object: "subscription_transaction", id: s.transactionId, product_store_identifier: key,
        purchased_at: ms(s.purchasedAt), expiration_date: ms(s.expiresAt), effective_expiration_date: ms(s.expiresAt),
        ...(s.refundAt ? { revenue_in_local_currency: { currency: "USD", gross: -9.99 } } : {}),
      }] : []));
    }
    throw new Error("Unexpected V2 fixture URL: "+url.pathname);
  };
}

import type { AiNovelBillingMembershipInfo, AiNovelBillingMembershipRecord, AiNovelBillingTransactionRecord } from "../../shared/types.ts";
import { isObject, type RevenueCatSnapshot, type RevenueCatSubscriptionEvidence } from "../../services/ainovel-revenuecat-types.ts";
import { REVENUECAT_ENTITLEMENT_IDS } from "./ainovel-revenuecat-entitlements.ts";
import { PRODUCTS, parseDate, nullableString, safeManagementUrl, sourceFromStore, platformFromStore, validCurrency, toMinorUnits } from "./ainovel-billing-values.ts";

export interface NormalizedRevenueCatSnapshot {
  membership: AiNovelBillingMembershipRecord;
  transactions: AiNovelBillingTransactionRecord[];
  ignoredEntitlementCount: number;
  ignoredProductCount: number;
  hasActiveUnverifiedEnvironmentEntitlement: boolean;
}
const STATUSES = new Set(["trialing", "active", "expired", "in_grace_period", "in_billing_retry", "paused", "unknown", "incomplete"]);
function autoRenew(value: unknown): boolean | null {
  if (value === "will_renew") return true;
  if (value === "will_not_renew") return false;
  return null;
}

export function normalizeRevenueCatSnapshot(payload: RevenueCatSnapshot, userId: string,
  now = new Date(), options: { allowSandbox?: boolean } = {}): NormalizedRevenueCatSnapshot {
  const candidates: Array<{ rank: number; info: AiNovelBillingMembershipInfo }> = [];
  const summaries: AiNovelBillingMembershipInfo[] = [];
  const transactions: AiNovelBillingTransactionRecord[] = [];
  let ignoredEntitlementCount = 0;
  let ignoredProductCount = 0;
  let hasActiveUnverifiedEnvironmentEntitlement = false;
  for (const evidence of payload.subscriptions) {
    const { subscription: sub, product, entitlements } = evidence;
    const productId = nullableString(product.store_identifier);
    const definition = productId ? PRODUCTS[productId] : undefined;
    const source = sourceFromStore(sub.store);
    if (!definition || !source || !productId) { ignoredProductCount++; continue; }
    const matches = entitlements.filter(e => e.lookup_key === REVENUECAT_ENTITLEMENT_IDS[definition.tier]);
    const active = matches.map(e => payload.activeEntitlements.find(a => a.entitlement_id === e.id));
    const hasActive = active.some(Boolean) && sub.gives_access === true;
    const environmentKnown = sub.environment === "sandbox" || sub.environment === "production";
    const allowed = sub.environment === "production" || (options.allowSandbox === true && sub.environment === "sandbox");
    if (hasActive && !allowed) hasActiveUnverifiedEnvironmentEntitlement = true;
    if (!environmentKnown || !allowed) { ignoredEntitlementCount++; continue; }
    if (typeof sub.gives_access !== "boolean" || !STATUSES.has(String(sub.status))) {
      throw new Error("RevenueCat subscription state is invalid.");
    }
    const currentEnd = parseDate(sub.current_period_ends_at);
    const entitlementEnd = active.filter(isObject).map(a => parseDate(a.expires_at))
      .filter((d): d is string | null => d !== undefined)
      .sort((a,b) => (b ? Date.parse(b) : Infinity) - (a ? Date.parse(a) : Infinity))[0];
    const subscriptionEnd = parseDate(sub.ends_at) ?? currentEnd;
    const scopedEnd = sub.status === "in_grace_period"
      ? graceEnd(subscriptionEnd, product.subscription) : subscriptionEnd;
    const expiresAt = hasActive && typeof entitlementEnd === "string" && typeof scopedEnd === "string"
      ? new Date(Math.min(Date.parse(entitlementEnd), Date.parse(scopedEnd))).toISOString() : scopedEnd;
    if (hasActive && typeof expiresAt !== "string") throw new Error("RevenueCat subscription expiry is invalid.");
    const renewable = autoRenew(sub.auto_renewal_status);
    const info: AiNovelBillingMembershipInfo = {
      active: hasActive && (expiresAt === null || (typeof expiresAt === "string" && Date.parse(expiresAt) > now.getTime())),
      state: "expired", tier: null, planKey: null, expiresAt: expiresAt ?? null,
      autoRenew: renewable, source, managementUrl: safeManagementUrl(sub.management_url),
    };
    if (info.active) {
      info.state = sub.status === "in_grace_period" ? "grace_period" : renewable === false ? "cancelled" : "active";
      info.tier = definition.tier;
      info.planKey = productId;
      candidates.push({ rank: definition.rank, info });
    } else ignoredEntitlementCount++;
    summaries.push(info);
    transactions.push(...normalizeTransactions(evidence, userId, payload.observedAt));
  }
  candidates.sort((a,b) => b.rank-a.rank ||
    (b.info.expiresAt ? Date.parse(b.info.expiresAt) : Infinity) -
    (a.info.expiresAt ? Date.parse(a.info.expiresAt) : Infinity));
  summaries.sort((a,b) => (b.expiresAt ? Date.parse(b.expiresAt) : 0) - (a.expiresAt ? Date.parse(a.expiresAt) : 0));
  const current = candidates[0]?.info ?? summaries[0];
  return {
    membership: { appId: "ai_novel", userId, active: current?.active ?? false,
      state: current?.state ?? "free", tier: current?.tier ?? null, planKey: current?.planKey ?? null,
      expiresAt: current?.expiresAt ?? null, autoRenew: current?.autoRenew ?? null,
      source: current?.source ?? null, managementUrl: current?.managementUrl ?? null,
      lastSyncedAt: payload.observedAt, accountDeletedAt: null },
    transactions, ignoredEntitlementCount, ignoredProductCount, hasActiveUnverifiedEnvironmentEntitlement,
  };
}

function normalizeTransactions(evidence: RevenueCatSubscriptionEvidence,
  userId: string, observedAt: string): AiNovelBillingTransactionRecord[] {
  const sub = evidence.subscription;
  const source = sourceFromStore(sub.store)!;
  const records: AiNovelBillingTransactionRecord[] = [];
  for (const tx of evidence.transactions) {
    const productId = nullableString(tx.product_store_identifier);
    const id = nullableString(tx.id);
    if (!productId || !PRODUCTS[productId] || !id) continue;
    const revenue = isObject(tx.revenue_in_local_currency) ? tx.revenue_in_local_currency : {};
    const currency = validCurrency(revenue.currency);
    const gross = typeof revenue.gross === "number" && Number.isFinite(revenue.gross) ? revenue.gross : undefined;
    const amount = toMinorUnits(gross, currency);
    records.push({
      appId: "ai_novel", userId, provider: "revenuecat", providerTransactionId: id,
      productId, productKey: productId, source, platform: platformFromStore(sub.store),
      status: amount !== null && amount > 0 ? "provider_paid"
        : sub.gives_access === true ? "entitlement_active" : "unknown",
      purchasedAt: parseDate(tx.purchased_at) ?? null, originalPurchaseDate: parseDate(sub.starts_at) ?? null,
      expiresAt: parseDate(tx.effective_expiration_date) ?? parseDate(tx.expiration_date) ?? null,
      refundedAt: null, autoRenew: autoRenew(sub.auto_renewal_status), isSandbox: sub.environment === "sandbox",
      // V2 transaction revenue has no refund-event time or reversal marker.
      // Only explicit authenticated webhook events classify refunds/reversals.
      amountMinor: amount, refundAmountMinor: null,
      // A lookup is not a new payment or refund reversal. Keep financial
      // evidence ordered by the transaction's provider timestamp.
      currency, observedAt: parseDate(tx.purchased_at) ?? observedAt, accountDeletedAt: null,
    });
  }
  return records;
}

function graceEnd(end: string | null | undefined, details: unknown): string | undefined {
  if (typeof end !== "string" || !isObject(details)) return undefined;
  const duration = typeof details.grace_period_duration === "string"
    ? details.grace_period_duration.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/) : null;
  if (!duration) return undefined;
  const seconds = Number(duration[1] ?? 0) * 604800 + Number(duration[2] ?? 0) * 86400 +
    Number(duration[3] ?? 0) * 3600 + Number(duration[4] ?? 0) * 60 + Number(duration[5] ?? 0);
  const timestamp = Date.parse(end) + seconds * 1000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

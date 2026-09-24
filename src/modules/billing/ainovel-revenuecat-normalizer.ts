import type {
  AiNovelBillingMembershipInfo,
  AiNovelBillingMembershipRecord,
  AiNovelBillingSource,
  AiNovelBillingTier,
  AiNovelBillingTransactionRecord,
  AiNovelBillingTransactionStatus,
} from "../../shared/types.ts";
import { isObject } from "../../services/ainovel-revenuecat-client.ts";
import { REVENUECAT_ENTITLEMENT_IDS } from "./ainovel-revenuecat-entitlements.ts";

const PRODUCTS: Record<string, { tier: AiNovelBillingTier; rank: number }> = {
  plus_monthly: { tier: "plus", rank: 1 },
  plus_quarterly: { tier: "plus", rank: 1 },
  plus_yearly: { tier: "plus", rank: 1 },
  pro_monthly: { tier: "pro", rank: 2 },
  pro_quarterly: { tier: "pro", rank: 2 },
  pro_yearly: { tier: "pro", rank: 2 },
};

export interface NormalizedRevenueCatSnapshot {
  membership: AiNovelBillingMembershipRecord;
  transactions: AiNovelBillingTransactionRecord[];
  ignoredEntitlementCount: number;
  ignoredProductCount: number;
  hasActiveUnverifiedEnvironmentEntitlement: boolean;
}

interface ActiveCandidate {
  info: AiNovelBillingMembershipInfo;
  rank: number;
}

function parseDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sourceFromStore(value: unknown): AiNovelBillingSource | undefined {
  if (value === "app_store" || value === "mac_app_store") return "app_store";
  if (value === "play_store") return "play_store";
  return undefined;
}

function platformFromStore(value: unknown): AiNovelBillingTransactionRecord["platform"] {
  if (value === "app_store") return "ios";
  if (value === "mac_app_store") return "macos";
  if (value === "play_store") return "android";
  return null;
}

function entitlementIsActive(
  entitlement: Record<string, unknown>,
  now: number,
): { active: boolean; expiresAt: string | null; graceExpiresAt: string | null } {
  const expiresAt = parseDate(entitlement.expires_date);
  const graceExpiresAt = parseDate(entitlement.grace_period_expires_date);
  if (expiresAt === undefined || graceExpiresAt === undefined) {
    return { active: false, expiresAt: null, graceExpiresAt: null };
  }
  return {
    active: expiresAt === null || Date.parse(expiresAt) > now ||
      (graceExpiresAt !== null && Date.parse(graceExpiresAt) > now),
    expiresAt,
    graceExpiresAt,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function safeManagementUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function subscriptionIsAutoRenewing(subscription: Record<string, unknown>): boolean | null {
  if (!Object.hasOwn(subscription, "unsubscribe_detected_at")) return null;
  return subscription.unsubscribe_detected_at === null;
}

function transactionIdentifier(
  subscription: Record<string, unknown>,
): string | undefined {
  return nullableString(subscription.store_transaction_id) ?? undefined;
}

function evidenceStatus(input: {
  refundedAt: string | null;
  expiresAt: string | null | undefined;
  activeEntitlement: boolean;
  now: number;
}): AiNovelBillingTransactionStatus {
  if (input.refundedAt) return "refunded";
  if (input.activeEntitlement) return "entitlement_active";
  if (input.expiresAt && Date.parse(input.expiresAt) <= input.now) return "expired";
  // A subscriber snapshot proves membership dates, not that money was charged.
  return "unknown";
}

export function normalizeRevenueCatSnapshot(
  payload: unknown,
  userId: string,
  now = new Date(),
  options: { allowSandbox?: boolean } = {},
): NormalizedRevenueCatSnapshot {
  if (!isObject(payload) || !isObject(payload.subscriber)) {
    throw new Error("RevenueCat subscriber payload is invalid.");
  }
  const subscriber = payload.subscriber;
  const allowSandbox = options.allowSandbox ?? false;
  const entitlements = isObject(subscriber.entitlements) ? subscriber.entitlements : {};
  const subscriptions = isObject(subscriber.subscriptions) ? subscriber.subscriptions : {};
  const nowIso = now.toISOString();
  const providerObservedAt = parseDate(payload.request_date_ms) ??
    parseDate(payload.request_date) ?? nowIso;
  const observedAt = typeof payload.request_date_ms === "number" ||
      typeof payload.request_date === "string"
    ? providerObservedAt
    : nowIso;
  const activeCandidates: ActiveCandidate[] = [];
  const activeEntitlementProducts = new Set<string>();
  const subscriptionSummaries: Array<Pick<AiNovelBillingTransactionRecord,
    "productKey" | "source" | "expiresAt" | "refundedAt" | "autoRenew"
  >> = [];
  let ignoredEntitlementCount = 0;
  let hasActiveUnverifiedEnvironmentEntitlement = false;

  for (const [entitlementId, rawEntitlement] of Object.entries(entitlements)) {
    if (!isObject(rawEntitlement)) {
      ignoredEntitlementCount++;
      continue;
    }
    const productId = nullableString(rawEntitlement.product_identifier);
    const product = productId ? PRODUCTS[productId] : undefined;
    const subscription = productId ? subscriptions[productId] : undefined;
    const matchesProductEntitlement = product !== undefined &&
      entitlementId === REVENUECAT_ENTITLEMENT_IDS[product.tier];
    const subscriptionIsObject = isObject(subscription);
    const source = subscriptionIsObject ? sourceFromStore(subscription.store) : undefined;
    const dates = entitlementIsActive(rawEntitlement, now.getTime());
    if (
      !allowSandbox && matchesProductEntitlement && subscriptionIsObject &&
      subscription.is_sandbox !== false && dates.active
    ) {
      hasActiveUnverifiedEnvironmentEntitlement = true;
    }
    const environmentAllowed = isObject(subscription) &&
      (subscription.is_sandbox === false ||
        (allowSandbox && subscription.is_sandbox === true));
    if (!product || !matchesProductEntitlement ||
        !isObject(subscription) || !environmentAllowed) {
      ignoredEntitlementCount++;
      continue;
    }
    if (!source || !dates.active) {
      ignoredEntitlementCount++;
      continue;
    }
    activeEntitlementProducts.add(productId as string);
    const grace = dates.expiresAt !== null && Date.parse(dates.expiresAt) <= now.getTime() &&
      dates.graceExpiresAt !== null && Date.parse(dates.graceExpiresAt) > now.getTime();
    const cancelled = subscriptionIsAutoRenewing(subscription) === false;
    activeCandidates.push({
      rank: product.rank,
      info: {
        active: true,
        state: grace ? "grace_period" : cancelled ? "cancelled" : "active",
        tier: product.tier,
        planKey: productId,
        // In a grace period the effective entitlement deadline is the grace
        // deadline, not the already elapsed renewal deadline.
        expiresAt: grace ? dates.graceExpiresAt : dates.expiresAt,
        autoRenew: subscriptionIsAutoRenewing(subscription),
        source,
        managementUrl: safeManagementUrl(subscriber.management_url),
      },
    });
  }

  let ignoredProductCount = 0;
  const transactions: AiNovelBillingTransactionRecord[] = [];
  for (const [productId, rawSubscription] of Object.entries(subscriptions)) {
    const product = PRODUCTS[productId];
    if (!product || !isObject(rawSubscription)) {
      ignoredProductCount++;
      continue;
    }
    const source = sourceFromStore(rawSubscription.store);
    const isSandbox = typeof rawSubscription.is_sandbox === "boolean"
      ? rawSubscription.is_sandbox
      : null;
    if (!source || (isSandbox !== false && !(allowSandbox && isSandbox === true))) {
      ignoredProductCount++;
      continue;
    }
    const purchasedAt = parseDate(rawSubscription.purchase_date);
    const originalPurchaseDate = parseDate(rawSubscription.original_purchase_date);
    const expiresAt = parseDate(rawSubscription.expires_date);
    const refundedAt = parseDate(rawSubscription.refunded_at);
    const entitlementActive = activeEntitlementProducts.has(productId);
    const status = evidenceStatus({
      refundedAt: refundedAt ?? null,
      expiresAt,
      activeEntitlement: entitlementActive,
      now: now.getTime(),
    });
    subscriptionSummaries.push({
      productKey: productId,
      source,
      expiresAt: expiresAt ?? null,
      refundedAt: refundedAt ?? null,
      autoRenew: subscriptionIsAutoRenewing(rawSubscription),
    });
    const providerTransactionId = transactionIdentifier(rawSubscription);
    // A subscriber snapshot can confirm membership without giving us a payment
    // transaction ID. Never turn that incomplete financial evidence into an
    // order with an invented local identifier.
    if (!providerTransactionId) continue;
    transactions.push({
      appId: "ai_novel",
      userId,
      provider: "revenuecat",
      providerTransactionId,
      productId,
      productKey: productId,
      source,
      platform: platformFromStore(rawSubscription.store),
      status,
      purchasedAt: purchasedAt ?? null,
      originalPurchaseDate: originalPurchaseDate ?? null,
      expiresAt: expiresAt ?? null,
      refundedAt: refundedAt ?? null,
      autoRenew: subscriptionIsAutoRenewing(rawSubscription),
      isSandbox,
      amountMinor: null,
      refundAmountMinor: null,
      currency: null,
      observedAt,
      accountDeletedAt: null,
    });
  }

  activeCandidates.sort((left, right) => {
    if (left.rank !== right.rank) return right.rank - left.rank;
    const leftExpiry = left.info.expiresAt ? Date.parse(left.info.expiresAt) : Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.info.expiresAt ? Date.parse(right.info.expiresAt) : Number.MAX_SAFE_INTEGER;
    return rightExpiry - leftExpiry;
  });
  const current = activeCandidates[0]?.info;
  const lastKnown = [...subscriptionSummaries].sort((left, right) => {
    const leftDate = left.expiresAt ? Date.parse(left.expiresAt) : 0;
    const rightDate = right.expiresAt ? Date.parse(right.expiresAt) : 0;
    return rightDate - leftDate;
  })[0];
  const membership: AiNovelBillingMembershipRecord = {
    appId: "ai_novel",
    userId,
    active: current?.active ?? false,
    state: current?.state ?? (lastKnown ? "expired" : "free"),
    tier: current?.tier ?? null,
    planKey: current?.planKey ?? null,
    expiresAt: current?.expiresAt ?? lastKnown?.expiresAt ?? null,
    autoRenew: current?.autoRenew ?? (lastKnown ? false : null),
    source: current?.source ?? lastKnown?.source ?? null,
    managementUrl: current?.managementUrl ?? safeManagementUrl(subscriber.management_url),
    lastSyncedAt: observedAt,
    accountDeletedAt: null,
  };

  return {
    membership,
    transactions,
    ignoredEntitlementCount,
    ignoredProductCount,
    hasActiveUnverifiedEnvironmentEntitlement,
  };
}

export function normalizeRevenueCatWebhookTransaction(input: {
  event: Record<string, unknown>;
  userId: string;
  observedAt: string;
}): AiNovelBillingTransactionRecord | undefined {
  const productId = nullableString(input.event.product_id);
  const product = productId ? PRODUCTS[productId] : undefined;
  const source = sourceFromStore(String(input.event.store ?? "").toLowerCase());
  const providerTransactionId = nullableString(input.event.transaction_id);
  if (!product || !productId || !source || !providerTransactionId) return undefined;
  const eventType = String(input.event.type ?? "");
  const isCustomerSupportRefund = eventType === "CANCELLATION" &&
    input.event.cancel_reason === "CUSTOMER_SUPPORT";
  const currency = validCurrency(input.event.currency);
  const rawAmount = input.event.price_in_purchased_currency;
  const financialAmount = isCustomerSupportRefund && typeof rawAmount === "number"
    ? Math.abs(rawAmount)
    : rawAmount;
  const eventAmount = toMinorUnits(financialAmount, currency);
  const isTrial = String(input.event.period_type ?? "").toUpperCase() === "TRIAL";
  const isPaidEvent = (eventType === "INITIAL_PURCHASE" || eventType === "RENEWAL" ||
    eventType === "REFUND_REVERSED") && !isTrial && eventAmount !== null && eventAmount > 0;
  const status: AiNovelBillingTransactionStatus | undefined = isCustomerSupportRefund
    ? "refunded"
    : eventType === "EXPIRATION"
      ? "expired"
      : eventType === "INITIAL_PURCHASE" || eventType === "RENEWAL"
        ? isTrial ? "entitlement_active" : isPaidEvent ? "provider_paid" : "unknown"
        : eventType === "REFUND_REVERSED"
          ? isPaidEvent ? "provider_paid" : "unknown"
          : undefined;
  if (!status) return undefined;
  const purchasedAt = parseDate(input.event.purchased_at_ms);
  const expiresAt = parseDate(input.event.expiration_at_ms);
  return {
    appId: "ai_novel",
    userId: input.userId,
    provider: "revenuecat",
    providerTransactionId,
    productId,
    productKey: productId,
    source,
    platform: platformFromStore(String(input.event.store ?? "").toLowerCase()),
    status,
    purchasedAt: purchasedAt ?? null,
    originalPurchaseDate: parseDate(input.event.original_purchased_at_ms) ?? null,
    expiresAt: expiresAt ?? null,
    refundedAt: status === "refunded" ? input.observedAt : null,
    autoRenew: eventType === "CANCELLATION" && !isCustomerSupportRefund ? false : null,
    isSandbox: input.event.environment === "SANDBOX",
    amountMinor: status === "refunded" || isTrial ? null : eventAmount,
    refundAmountMinor: status === "refunded" ? eventAmount : eventType === "REFUND_REVERSED" ? 0 : null,
    currency,
    observedAt: input.observedAt,
    accountDeletedAt: null,
  };
}

function validCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function toMinorUnits(value: unknown, currency: string | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !currency) return null;
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    const amount = Math.round(value * (10 ** digits));
    return Number.isSafeInteger(amount) ? amount : null;
  } catch {
    return null;
  }
}

import type { AiNovelBillingTransactionRecord, AiNovelBillingTransactionStatus } from "../../shared/types.ts";
import { PRODUCTS, parseDate, nullableString, sourceFromStore, platformFromStore, validCurrency, toMinorUnits } from "./ainovel-billing-values.ts";

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

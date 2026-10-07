import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { AiNovelBillingMembershipRecord, AiNovelBillingTransactionRecord } from "../shared/types.ts";
import type { AlipayOrder } from "../modules/billing/alipay-models.ts";
import { anchorMembershipCredits } from "../modules/billing/billing-credit-window.ts";

export function alipayTransaction(order: AlipayOrder, now: string): AiNovelBillingTransactionRecord {
  return { appId: "ai_novel", userId: order.userId, provider: "alipay", providerTransactionId: order.orderId, createdAt: order.createdAt,
    providerOrderId: order.providerTransactionId, checkoutId: order.orderId, distribution: order.distribution,
    productId: order.productKey, productKey: order.productKey, source: "alipay", platform: order.platform,
    status: order.status === "paid" ? "provider_paid" : order.status, purchasedAt: order.paidAt,
    originalPurchaseDate: order.paidAt, expiresAt: order.membershipExpiresAt, refundedAt: null,
    autoRenew: false, isSandbox: order.environment === "sandbox", amountMinor: order.amountMinor,
    refundAmountMinor: null, currency: "CNY", observedAt: now, accountDeletedAt: order.accountDeletedAt };
}
/** Bounded per-tier projection; no all-order financial history fetch. */
export async function refreshAlipayMembership(database: ApplicationDatabase, userId: string, now: Date): Promise<AiNovelBillingMembershipRecord | undefined> {
  const current = await database.findAiNovelBillingMembership("ai_novel", userId);
  if (current?.accountDeletedAt || (current && current.source !== "alipay")) return current;
  const active = await database.listAiNovelAlipayAccess(userId, now.toISOString());
  const best = active.find(order => order.productKey.startsWith("pro_")) ?? active[0];
  if (!best) {
    if (!current) return undefined;
    const expired = { ...current, active: false, state: "expired" as const, autoRenew: false };
    if (current.active || current.state !== "expired") await database.upsertAiNovelBillingMembership(expired);
    return expired;
  }
  const membership: AiNovelBillingMembershipRecord = { appId: "ai_novel", userId, active: true, state: "active",
    tier: best.productKey.startsWith("pro_") ? "pro" : "plus", planKey: best.productKey,
    expiresAt: best.membershipExpiresAt, autoRenew: false, source: "alipay", managementUrl: null,
    lastSyncedAt: now.toISOString(), accountDeletedAt: null };
  const anchored = anchorMembershipCredits(current, membership, await database.listAiNovelBillingTransactions("ai_novel", userId));
  await database.upsertAiNovelBillingMembership(anchored);
  return anchored;
}

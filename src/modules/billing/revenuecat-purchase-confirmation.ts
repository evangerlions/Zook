import type { AiNovelBillingMembershipInfo, AiNovelBillingSource, AiNovelBillingTransactionRecord } from "../../shared/types.ts";
import type { NormalizedRevenueCatSnapshot } from "./ainovel-revenuecat-normalizer.ts";
import { billingChannelsConflict } from "./billing-channel-policy.ts";
import type { PurchaseReference, TargetPurchase } from "./membership-sync.ts";

/** Access evidence stays tied to the subscription that supplied this transaction. */
export interface RevenueCatPurchaseEntitlement {
  transactionId: string;
  source: AiNovelBillingSource;
  state: "active" | "elapsed" | "pending";
}

export interface PersistedRevenueCatPurchase {
  transaction: AiNovelBillingTransactionRecord;
  accessSnapshotCurrent: boolean;
}

export function revenueCatPurchaseEntitlements(transactions: AiNovelBillingTransactionRecord[],
  activeProductKey: string | undefined, now: Date): RevenueCatPurchaseEntitlement[] {
  return transactions.map(transaction => {
    const start = transaction.purchasedAt ? Date.parse(transaction.purchasedAt) : NaN;
    const end = transaction.expiresAt ? Date.parse(transaction.expiresAt) : NaN;
    const knownPeriod = start <= now.getTime() && end > start;
    const state: RevenueCatPurchaseEntitlement["state"] = !knownPeriod ? "pending"
      : end <= now.getTime() ? "elapsed" : transaction.productKey === activeProductKey ? "active" : "pending";
    return {
      transactionId: transaction.providerTransactionId,
      source: transaction.source,
      // A verified elapsed period is processed history, not a new access grant.
      state,
    };
  });
}

export function revenueCatTargetPurchase(reference: PurchaseReference,
  snapshot: NormalizedRevenueCatSnapshot, persisted: PersistedRevenueCatPurchase | undefined,
  membership: AiNovelBillingMembershipInfo): TargetPurchase {
  const pending: TargetPurchase = { reference, status: "pending", entitlementStatus: "pending" };
  const transaction = snapshot.transactions.find(record => record.providerTransactionId === reference.id);
  const financial = persisted?.transaction;
  if (!transaction || !financial || financial.productKey !== transaction.productKey ||
      financial.source !== transaction.source) return pending;
  if (financial.accountDeletedAt || financial.status === "refunded" || financial.status === "revoked") {
    return { reference, status: "paid", entitlementStatus: "blocked" };
  }
  if (financial.status !== "provider_paid") return pending;
  const evidence = snapshot.purchaseEntitlements.find(item => item.transactionId === reference.id && item.source === transaction.source);
  // Historical completion cannot take over a later, legitimately switched channel.
  if (evidence?.state === "elapsed") return { reference, status: "paid", entitlementStatus: "applied" };
  if (membership.active && billingChannelsConflict(membership.source, transaction.source)) {
    return { reference, status: "paid", entitlementStatus: "blocked" };
  }
  const applied = evidence?.state === "active" && persisted!.accessSnapshotCurrent;
  return { reference, status: "paid", entitlementStatus: applied ? "applied" : "pending" };
}

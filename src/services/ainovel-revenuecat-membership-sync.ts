import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { NormalizedRevenueCatSnapshot } from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import type { AiNovelBillingMembershipInfo } from "../shared/types.ts";
import type { MembershipSyncInput, MembershipSyncResult, TargetPurchase } from "../modules/billing/membership-sync.ts";
import { storeSnapshotConflicts } from "../modules/billing/billing-channel-policy.ts";
import { RevenueCatApiError } from "./ainovel-revenuecat-client.ts";
interface Dependencies {
  logger: StructuredLogger;
  fetchSnapshot: () => Promise<NormalizedRevenueCatSnapshot>;
  persistSnapshot: (snapshot: NormalizedRevenueCatSnapshot) => Promise<void>;
  getMembership: () => Promise<AiNovelBillingMembershipInfo>;
  now: () => Date;
}
export async function syncRevenueCatMembership(input: MembershipSyncInput, d: Dependencies): Promise<MembershipSyncResult> {
  const context = { requestId: input.requestId, userId: input.userId, provider: "revenuecat" };
  let snapshot: NormalizedRevenueCatSnapshot | undefined;
  try { snapshot = await d.fetchSnapshot(); }
  catch (error) {
    input.signal?.throwIfAborted();
    d.logger.warn("membership provider snapshot pending", { ...context, reason: error instanceof RevenueCatApiError ? error.reason : "normalization_failed", ...(error instanceof RevenueCatApiError ? error.diagnostics : {}) });
  }
  input.signal?.throwIfAborted();
  const verified = snapshot && !snapshot.hasActiveUnverifiedEnvironmentEntitlement;
  if (verified) {
    try { await d.persistSnapshot(snapshot); }
    catch (error) { d.logger.error("membership persistence failed", { ...context, failureReason: "database_error" }); throw error; }
  }
  const membership = await d.getMembership();
  let targetPurchase: TargetPurchase | null = input.purchaseReference ? {
    reference: input.purchaseReference, status: "pending", entitlementStatus: "pending",
  } : null;
  if (verified && targetPurchase) {
    const transaction = snapshot.transactions.find(t => t.providerTransactionId === input.purchaseReference!.id && t.status === "provider_paid" && !t.accountDeletedAt);
    if (transaction) targetPurchase = { ...targetPurchase, status: "paid",
      entitlementStatus: membership.active && membership.source === transaction.source && membership.planKey === transaction.productKey &&
        !!transaction.expiresAt && Date.parse(transaction.expiresAt) > d.now().getTime() ? "applied" : "pending" };
  }
  const pending = !verified || storeSnapshotConflicts(snapshot!, membership) || targetPurchase?.entitlementStatus === "pending";
  const result: MembershipSyncResult = { syncStatus: pending ? "pending" : "complete", membership, targetPurchase,
    pendingOrderCount: pending ? 1 : 0, checkedAt: d.now().toISOString() };
  d.logger.info("membership sync completed", { ...context, syncStatus: result.syncStatus });
  return result;
}

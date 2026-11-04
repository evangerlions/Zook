import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { NormalizedRevenueCatSnapshot } from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import type { AiNovelBillingMembershipInfo } from "../shared/types.ts";
import { revenueCatTargetPurchase, type PersistedRevenueCatPurchase } from "../modules/billing/revenuecat-purchase-confirmation.ts";
import type { MembershipSyncInput, MembershipSyncResult, TargetPurchase } from "../modules/billing/membership-sync.ts";
import { storeSnapshotConflicts } from "../modules/billing/billing-channel-policy.ts";
import { RevenueCatApiError } from "./ainovel-revenuecat-client.ts";
interface Dependencies {
  logger: StructuredLogger;
  fetchSnapshot: () => Promise<NormalizedRevenueCatSnapshot>;
  persistSnapshot: (snapshot: NormalizedRevenueCatSnapshot, transactionId?: string) => Promise<PersistedRevenueCatPurchase | undefined>;
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
  const verifiedSnapshot = snapshot && !snapshot.hasActiveUnverifiedEnvironmentEntitlement ? snapshot : undefined;
  let persisted: PersistedRevenueCatPurchase | undefined;
  if (verifiedSnapshot) {
    try { persisted = await d.persistSnapshot(verifiedSnapshot, input.purchaseReference?.id); }
    catch (error) { d.logger.error("membership persistence failed", { ...context, failureReason: "database_error" }); throw error; }
  }
  const membership = await d.getMembership();
  let targetPurchase: TargetPurchase | null = input.purchaseReference ? {
    reference: input.purchaseReference, status: "pending", entitlementStatus: "pending",
  } : null;
  if (verifiedSnapshot && targetPurchase) {
    targetPurchase = revenueCatTargetPurchase(targetPurchase.reference, verifiedSnapshot, persisted, membership);
  }
  const pending = !verifiedSnapshot || storeSnapshotConflicts(verifiedSnapshot, membership) || targetPurchase?.entitlementStatus === "pending";
  const result: MembershipSyncResult = { syncStatus: pending ? "pending" : "complete", membership, targetPurchase,
    pendingOrderCount: pending ? 1 : 0, checkedAt: d.now().toISOString() };
  d.logger.info("membership sync completed", { ...context, syncStatus: result.syncStatus });
  return result;
}

import type { MembershipSyncInput, MembershipSyncResult } from "../modules/billing/membership-sync.ts";
import { normalizeRevenueCatSnapshot, type NormalizedRevenueCatSnapshot } from "../modules/billing/ainovel-revenuecat-normalizer.ts";
import { appleSandboxPayload } from "../modules/billing/apple-sandbox-access.ts";
import { inBillingEnvironment } from "../modules/billing/billing-environment.ts";
import type { RevenueCatSnapshot } from "./ainovel-revenuecat-types.ts";
import { syncRevenueCatMembership, type RevenueCatMembershipSyncDependencies } from "./ainovel-revenuecat-membership-sync.ts";

/** An admitted tester can still buy for real after installing the App Store app. */
export async function syncAppleReviewMembership(input: MembershipSyncInput,
  dependencies: RevenueCatMembershipSyncDependencies, read: () => Promise<RevenueCatSnapshot>,
  now: () => Date): Promise<MembershipSyncResult> {
  let snapshot: NormalizedRevenueCatSnapshot;
  try {
    const payload = await read();
    const formal = inBillingEnvironment("production", () =>
      normalizeRevenueCatSnapshot(payload, input.userId, now(), { allowSandbox: false }));
    const formalTarget = input.purchaseReference && formal.transactions.some(tx => tx.providerTransactionId === input.purchaseReference!.id);
    snapshot = formal.activeMemberships.length > 0 || formalTarget ? formal
      : inBillingEnvironment("sandbox", () => normalizeRevenueCatSnapshot(
        appleSandboxPayload(payload), input.userId, now(), { allowSandbox: true }));
  } catch (error) {
    // Reuse the existing pending/cancellation behavior, without a second lookup.
    return syncRevenueCatMembership(input, { ...dependencies, fetchSnapshot: () => Promise.reject(error) });
  }
  return inBillingEnvironment(snapshot.membership.environment!, () => syncRevenueCatMembership(input,
    { ...dependencies, fetchSnapshot: async () => snapshot }));
}

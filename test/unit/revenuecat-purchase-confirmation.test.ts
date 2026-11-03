import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRevenueCatSnapshot } from "../../src/modules/billing/ainovel-revenuecat-normalizer.ts";
import { revenueCatTargetPurchase } from "../../src/modules/billing/revenuecat-purchase-confirmation.ts";
import { buildEmptyMembershipInfo } from "../../src/modules/billing/billing-membership.ts";
import type { RevenueCatSubscriptionEvidence } from "../../src/services/ainovel-revenuecat-types.ts";

const now = new Date("2026-11-03T00:00:00Z");
function subscription(id: string, access: boolean): RevenueCatSubscriptionEvidence {
  return {
    subscription: { id, customer_id: "alice", product_id: "product", store: "app_store", environment: "production",
      gives_access: access, status: access ? "active" : "incomplete", auto_renewal_status: "will_renew",
      current_period_ends_at: Date.parse("2026-12-03T00:00:00Z") },
    product: { store_identifier: "plus_monthly" },
    entitlements: [{ id: "ent-plus", lookup_key: "orangewrite_plus" }],
    transactions: [{ id, product_store_identifier: "plus_monthly", purchased_at: Date.parse("2026-11-02T00:00:00Z"),
      expiration_date: Date.parse("2026-12-03T00:00:00Z"), revenue_in_local_currency: { currency: "USD", gross: 9.99 } }],
  };
}
function normalize(subscriptions: RevenueCatSubscriptionEvidence[]) {
  return normalizeRevenueCatSnapshot({ subscriptions, activeEntitlements: [{ entitlement_id: "ent-plus",
    expires_at: Date.parse("2026-12-03T00:00:00Z") }], observedAt: now.toISOString() }, "alice", now);
}

test("an older active subscription for the same product cannot confirm another subscription's transaction", () => {
  const snapshot = normalize([subscription("old-transaction", true), subscription("new-transaction", false)]);
  const transaction = snapshot.transactions.find(record => record.providerTransactionId === "new-transaction")!;
  const result = revenueCatTargetPurchase({ kind: "store_transaction", id: "new-transaction" },
    snapshot, { transaction, accessSnapshotCurrent: true }, snapshot.membership);
  assert.equal(snapshot.membership.active, true);
  assert.equal(result.status, "paid");
  assert.equal(result.entitlementStatus, "pending");
});

test("an active subscription cannot confirm a future-dated transaction", () => {
  const evidence = subscription("future-transaction", true);
  evidence.transactions[0].purchased_at = Date.parse("2026-11-04T00:00:00Z");
  const snapshot = normalize([evidence]);
  const result = revenueCatTargetPurchase({ kind: "store_transaction", id: "future-transaction" },
    snapshot, { transaction: snapshot.transactions[0], accessSnapshotCurrent: true }, snapshot.membership);
  assert.equal(result.entitlementStatus, "pending");
});

test("an unmatched configured entitlement cannot confirm an active paid transaction", () => {
  const evidence = subscription("wrong-entitlement", true);
  evidence.entitlements[0].lookup_key = "orangewrite_pro";
  const snapshot = normalize([evidence]);
  const result = revenueCatTargetPurchase({ kind: "store_transaction", id: "wrong-entitlement" },
    snapshot, { transaction: snapshot.transactions[0], accessSnapshotCurrent: true }, snapshot.membership);
  assert.equal(result.status, "paid");
  assert.equal(result.entitlementStatus, "pending");
});

test("missing local persistence cannot confirm a fully verified provider transaction", () => {
  const snapshot = normalize([subscription("not-persisted", true)]);
  assert.equal(revenueCatTargetPurchase({ kind: "store_transaction", id: "not-persisted" }, snapshot,
    undefined, snapshot.membership).entitlementStatus, "pending");
});

test("deleted-account financial evidence and a conflicting Alipay membership stay blocked", () => {
  const snapshot = normalize([subscription("target", true)]);
  const reference = { kind: "store_transaction" as const, id: "target" };
  const transaction = snapshot.transactions[0];
  assert.equal(revenueCatTargetPurchase(reference, snapshot,
    { transaction: { ...transaction, accountDeletedAt: now.toISOString() }, accessSnapshotCurrent: true }, { ...buildEmptyMembershipInfo(), tier: null, source: null, managementUrl: null }).entitlementStatus, "blocked");
  assert.equal(revenueCatTargetPurchase(reference, snapshot, { transaction, accessSnapshotCurrent: true },
    { ...snapshot.membership, source: "alipay" }).entitlementStatus, "blocked");
});

test("elapsed history completes across a later Alipay switch, but never bypasses a trusted refund", () => {
  const evidence = subscription("historical", false);
  evidence.subscription.status = "expired";
  evidence.subscription.current_period_ends_at = Date.parse("2026-11-02T12:00:00Z");
  evidence.transactions[0].expiration_date = Date.parse("2026-11-02T12:00:00Z");
  const snapshot = normalize([evidence]);
  const membership = { ...snapshot.membership, active: true, source: "alipay" as const, tier: "pro" as const,
    planKey: "pro_yearly", expiresAt: "2027-01-01T00:00:00Z" };
  for (const status of ["provider_paid", "refunded", "revoked"] as const) {
    const result = revenueCatTargetPurchase({ kind: "store_transaction", id: "historical" }, snapshot,
      { transaction: { ...snapshot.transactions[0], status }, accessSnapshotCurrent: false }, membership);
    assert.equal(result.status, "paid");
    assert.equal(result.entitlementStatus, status === "provider_paid" ? "applied" : "blocked");
  }
  assert.equal(membership.source, "alipay");
  assert.equal(membership.expiresAt, "2027-01-01T00:00:00Z");
});

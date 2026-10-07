import assert from "node:assert/strict";
import test from "node:test";
import { anchorMembershipCredits } from "../../src/modules/billing/billing-credit-window.ts";
import type { AiNovelBillingMembershipRecord, AiNovelBillingTransactionRecord } from "../../src/shared/types/ainovel-billing.ts";

const record = (source: "alipay" | "app_store" = "app_store"): AiNovelBillingMembershipRecord => ({
  appId: "ai_novel", userId: "u", active: true, state: "active", tier: "plus", planKey: "plus_monthly",
  expiresAt: "2026-12-01T00:00:00Z", source, autoRenew: true, managementUrl: null,
  lastSyncedAt: "2026-11-02T00:00:00Z", accountDeletedAt: null,
});
const paid = (start: string, end: string, source: "alipay" | "app_store" = "app_store") => ({
  purchasedAt: start, expiresAt: end, originalPurchaseDate: "2020-01-01T00:00:00Z", source,
  status: "provider_paid" as const, accountDeletedAt: null,
});
for (const source of ["alipay", "app_store"] as const) {
  test(`${source}: first purchase anchors at verified payment, never lookup or original metadata`, () => {
    const next = anchorMembershipCredits(undefined, record(source), [paid("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", source)]);
    assert.equal(next.creditWindowAnchorAt, "2026-11-01T00:00:00.000Z");
  });
  test(`${source}: multiple missed continuous renewals and upgrade preserve original anchor`, () => {
    const prior = { ...record(source), expiresAt: "2026-10-01T00:00:00Z", creditWindowAnchorAt: "2026-09-01T00:00:00Z" };
    const next = anchorMembershipCredits(prior, { ...record(source), tier: "pro" }, [
      paid("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", source),
      paid("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", source),
    ]);
    assert.equal(next.creditWindowAnchorAt, prior.creditWindowAnchorAt);
  });
  test(`${source}: real gap then renewals resets even without expiry lookup`, () => {
    const prior = { ...record(source), expiresAt: "2026-09-30T00:00:00Z", creditWindowAnchorAt: "2026-09-01T00:00:00Z" };
    const next = anchorMembershipCredits(prior, record(source), [
      paid("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", source),
      paid("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", source),
    ]);
    assert.equal(next.creditWindowAnchorAt, "2026-10-01T00:00:00.000Z");
  });
}
test("refunds, missing dates, future purchases and conflicting channels cannot create an anchor", () => {
  const invalid = [
    { ...paid("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"), status: "refunded" },
    { ...paid("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"), status: "unknown" },
    paid("2026-11-03T00:00:00Z", "2026-12-01T00:00:00Z"),
    paid("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", "alipay"),
  ] as AiNovelBillingTransactionRecord[];
  assert.equal(anchorMembershipCredits(undefined, record(), invalid).creditWindowAnchorAt, undefined);
});

test("verified active trial access keeps existing billing eligibility and uses its activation timestamp", () => {
  const trial = { ...paid("2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z"), status: "entitlement_active" as const };
  assert.equal(anchorMembershipCredits(undefined, { ...record(), expiresAt: trial.expiresAt }, [trial]).creditWindowAnchorAt, "2026-11-01T00:00:00.000Z");
});

test("verified continuous grace access preserves the paid anchor without starting another window", () => {
  const prior = { ...record(), expiresAt: "2026-11-01T00:00:00Z", creditWindowAnchorAt: "2026-10-01T00:00:00Z" };
  const grace = { ...record(), state: "grace_period" as const, expiresAt: "2026-11-08T00:00:00Z" };
  const purchases = [paid("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")];
  const extended = anchorMembershipCredits(prior, grace, purchases);
  assert.equal(extended.creditWindowAnchorAt, prior.creditWindowAnchorAt);
  assert.equal(anchorMembershipCredits(extended, { ...grace, expiresAt: "2026-11-15T00:00:00Z" }, purchases).creditWindowAnchorAt, prior.creditWindowAnchorAt);
});

test("first sync and legacy grace membership derive the verified continuous activation anchor", () => {
  const grace = { ...record(), state: "grace_period" as const, expiresAt: "2026-11-08T00:00:00Z" };
  const purchases = [paid("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")];
  for (const previous of [undefined, grace]) {
    assert.equal(anchorMembershipCredits(previous, grace, purchases).creditWindowAnchorAt, "2026-10-01T00:00:00.000Z");
  }
  assert.equal(anchorMembershipCredits(undefined, grace, []).creditWindowAnchorAt, undefined);
});

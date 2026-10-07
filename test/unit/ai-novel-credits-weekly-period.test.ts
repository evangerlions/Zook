import assert from "node:assert/strict";
import test from "node:test";
import { creditsPeriod, refreshCreditsAccount, LOCAL_CREDIT_QUOTAS, type CreditsTier } from "../../src/modules/ai-novel/credits/ai-novel-credits-model.ts";

const anchor = "2026-10-28T15:00:00.000Z";
for (const tier of ["free", "plus", "pro"] satisfies CreditsTier[]) {
  test(`${tier}: only seven-day periods, no refill at a calendar month boundary`, () => {
    const before = new Date("2026-10-31T23:59:59Z");
    const after = new Date("2026-11-01T00:00:00Z");
    const account = refreshCreditsAccount(undefined, { tier, anchorAt: anchor }, before);
    account.periodicMicros = "1000000";
    account.spentMicros = String(BigInt(LOCAL_CREDIT_QUOTAS[tier] - 1) * 1000000n);
    account.giftMicros = "7000000";
    assert.equal(account.refreshAt, "2026-11-04T15:00:00.000Z");
    assert.deepEqual(creditsPeriod(anchor, before), creditsPeriod(anchor, after));
    assert.deepEqual(refreshCreditsAccount(account, { tier, anchorAt: anchor }, after), account);
    const refreshed = refreshCreditsAccount(account, tier, new Date(account.refreshAt));
    assert.equal(refreshed.refreshAt, "2026-11-11T15:00:00.000Z");
    assert.equal(refreshed.giftMicros, "7000000");
    assert.deepEqual(refreshCreditsAccount(refreshed, tier, new Date(account.refreshAt)), refreshed);
  });
}

test("Plus to Pro inside a week preserves its reset date and used points", () => {
  const account = refreshCreditsAccount(undefined, "plus", new Date("2026-10-06T12:00:00Z"));
  account.periodicMicros = "400000000";
  const upgraded = refreshCreditsAccount(account, "pro", new Date("2026-10-08T18:00:00Z"));
  assert.equal(upgraded.refreshAt, account.refreshAt);
  assert.equal(upgraded.periodicMicros, "3400000000");
});

test("renewal changes expiry only; repurchase resets even without an intervening Free read", () => {
  const start = "2026-10-06T15:00:00Z";
  const now = new Date("2026-10-08T15:00:00Z");
  const account = refreshCreditsAccount(undefined, { tier: "plus", anchorAt: start, expiresAt: "2026-11-06T15:00:00Z" }, now);
  account.periodicMicros = "400000000";
  account.spentMicros = "600000000";
  const renewed = refreshCreditsAccount(account, { tier: "plus", anchorAt: start, expiresAt: "2026-12-06T15:00:00Z" }, now);
  assert.equal(renewed.periodicMicros, "400000000");
  assert.equal(renewed.refreshAt, account.refreshAt);
  const repurchased = refreshCreditsAccount(renewed, { tier: "plus", anchorAt: "2026-12-07T10:00:00Z" }, new Date("2026-12-07T12:00:00Z"));
  assert.equal(repurchased.periodicMicros, "1000000000");
  assert.equal(repurchased.refreshAt, "2026-12-14T10:00:00.000Z");
});

test("repeated downgrade and upgrade cannot repeatedly claim the allowance difference", () => {
  const now = new Date("2026-10-08T15:00:00Z");
  const account = refreshCreditsAccount(undefined, "plus", now);
  account.periodicMicros = "400000000";
  const pro = refreshCreditsAccount(account, "pro", now);
  const plus = refreshCreditsAccount(pro, "plus", now);
  assert.equal(refreshCreditsAccount(plus, "pro", now).periodicMicros, "3400000000");
  plus.periodicMicros = "900000000";
  plus.spentMicros = "700000000";
  assert.equal(refreshCreditsAccount(plus, "pro", now).periodicMicros, "3300000000");
});

test("missed weeks never accumulate and gifts survive; stale snapshots cannot revert entitlement", () => {
  const account = refreshCreditsAccount(undefined, { tier: "pro", anchorAt: anchor, observedAt: anchor }, new Date(anchor));
  account.periodicMicros = "0";
  account.giftMicros = "7000000";
  const next = refreshCreditsAccount(account, { tier: "pro", anchorAt: anchor, observedAt: "2027-01-01T00:00:00Z" }, new Date("2027-01-01T00:00:00Z"));
  assert.equal(next.periodicMicros, "4000000000");
  assert.equal(next.giftMicros, "7000000");
  assert.throws(() => refreshCreditsAccount(next, { tier: "plus", observedAt: anchor }, new Date("2027-01-01T00:00:00Z")));
});

test("each account has an independent anchor; exact week boundary advances once", () => {
  const now = new Date("2026-10-08T15:00:00Z");
  const first = refreshCreditsAccount(undefined, "free", now);
  const second = refreshCreditsAccount(undefined, "free", new Date("2026-10-09T15:00:00Z"));
  assert.notEqual(first.refreshAt, second.refreshAt);
  const before = new Date(Date.parse(first.refreshAt) - 1);
  assert.equal(refreshCreditsAccount(first, "free", before).periodKey, first.periodKey);
  assert.notEqual(refreshCreditsAccount(first, "free", new Date(first.refreshAt)).periodKey, first.periodKey);
});

test("legacy paid balances get anchor metadata without a free refill", () => {
  const account = { tier: "plus" as const, periodKey: "plus:2026-10-01T00:00:00Z", refreshAt: "2026-11-01T00:00:00Z", periodicMicros: "400000000", giftMicros: "7000000" };
  const migrated = refreshCreditsAccount(account, { tier: "plus", anchorAt: "2026-10-02T15:00:00Z" }, new Date("2026-10-06T15:00:00Z"));
  assert.equal(migrated.periodicMicros, "400000000");
  assert.equal(migrated.spentMicros, "600000000");
  assert.equal(migrated.giftMicros, "7000000");
  assert.equal(migrated.refreshAt, "2026-10-09T15:00:00.000Z");
});

test("paid snapshot captured before expiry cannot restore quota after transaction time expires it", () => {
  const paid = { tier: "plus" as const, anchorAt: "2026-10-01T15:00:00Z", expiresAt: "2026-10-06T15:00:00Z", observedAt: "2026-10-01T15:00:00Z" };
  const account = refreshCreditsAccount(undefined, paid, new Date("2026-10-02T15:00:00Z"));
  account.periodicMicros = "100000000";
  const now = new Date(paid.expiresAt);
  const expired = refreshCreditsAccount(account, { tier: "free", observedAt: paid.observedAt }, now);
  const stale = refreshCreditsAccount(expired, paid, now);
  assert.equal(stale.tier, "free");
  assert.equal(stale.periodicMicros, "20000000");
});

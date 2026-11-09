import assert from "node:assert/strict";
import test from "node:test";
import { revenueCatAutoRenew, revenueCatIsCancelled } from "../../src/modules/billing/revenuecat-renewal-status.ts";

test("maps all RevenueCat renewal states without treating pause or consent as cancellation", () => {
  const cases: Array<[string, boolean | null, boolean]> = [
    ["will_renew", true, false], ["will_not_renew", false, true],
    ["will_change_product", true, false], ["will_pause", false, false],
    ["requires_price_increase_consent", true, false], ["has_already_renewed", true, false],
    ["future_status", null, false],
  ];
  for (const [status, expected, cancelled] of cases) {
    const subscription = { auto_renewal_status: status };
    assert.equal(revenueCatAutoRenew(subscription), expected, status);
    assert.equal(revenueCatIsCancelled(subscription), cancelled, status);
  }
});

test("an already-paid period treats explicit cancellation or pause as false", () => {
  for (const [next, expected] of [["will_renew", true], ["will_not_renew", false],
    ["will_pause", false], ["requires_price_increase_consent", true], ["has_already_renewed", true]] as const) {
    assert.equal(revenueCatAutoRenew({ auto_renewal_status: "has_already_renewed",
      pending_changes: { auto_renewal_status: next } }), expected, next);
  }
  assert.equal(revenueCatAutoRenew({ auto_renewal_status: "has_already_renewed", pending_changes: {} }), true);
  assert.equal(revenueCatIsCancelled({ auto_renewal_status: "has_already_renewed",
    pending_changes: { auto_renewal_status: "will_not_renew" } }), true);
});

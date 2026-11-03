import assert from "node:assert/strict";
import test from "node:test";
import { toMinorUnits } from "../../src/modules/billing/ainovel-billing-values.ts";

test("payment amounts use the currency's fraction digits", () => {
  assert.equal(toMinorUnits(38.25, "CNY"), 3825);
  assert.equal(toMinorUnits(100, "JPY"), 100);
  assert.equal(toMinorUnits(1.234, "KWD"), 1234);
  assert.equal(toMinorUnits(1.2345, "CLF"), 12345);
  assert.equal(toMinorUnits(9.999, "USD"), 1000);
});

test("unusable payment amounts cannot become financial evidence", () => {
  for (const amount of [-1, NaN, Infinity, "38.00", Number.MAX_SAFE_INTEGER]) {
    assert.equal(toMinorUnits(amount, "CNY"), null);
  }
  assert.equal(toMinorUnits(38, null), null);
  assert.equal(toMinorUnits(38, "invalid"), null);
});

import { Decimal } from "decimal.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reconcile,
  type Fill,
} from "../../src/modules/lighttick/investments/accounting.ts";
import { decimalInput } from "../../src/modules/lighttick/investments/decimal.ts";
const golden = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/lighttick/investment-accounting-golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const sample of golden.cases)
  test("sealed legacy accounting parity: " + sample.name, () =>
    assert.deepEqual(
      reconcile(
        sample.opening_cash,
        sample.cash_events,
        sample.fills,
        sample.opening_positions,
        sample.marks,
      ),
      sample.expected,
    ),
  );
test("decimal boundary rejects binary floats, nonfinite values, too much precision and oversells", () => {
  for (const value of [
    0.1,
    "NaN",
    "Infinity",
    "0xFF",
    "1000000000000000000",
    "0.00000000001",
    "-1",
    "1e-99999999999999999999",
    "1e99999999999999999999",
    "0e-99999999999999999999",
    {},
    null,
  ])
    assert.throws(() => decimalInput(value), { statusCode: 422 });
  assert.equal(decimalInput("0.1000000000"), "0.1");
  assert.equal(decimalInput(" 0.1 "), "0.1");
  assert.equal(decimalInput("1e-10"), "0.0000000001");
  assert.equal(
    decimalInput("999999999999999999.9999999999"),
    "999999999999999999.9999999999",
  );
  assert.throws(
    () =>
      reconcile(
        "100",
        [],
        [
          {
            instrument_id: "synthetic",
            side: "sell",
            price: "1",
            quantity: "1",
            fee: "0",
            tax: "0",
          },
        ],
      ),
    { statusCode: 422 },
  );
  assert.throws(
    () =>
      reconcile(
        "100",
        [],
        [
          {
            instrument_id: "synthetic",
            side: "buy",
            price: "1",
            quantity: "1",
            fee: undefined,
            tax: "0",
          } as unknown as Fill,
        ],
      ),
    { statusCode: 422 },
  );
});

test("accounting precision is independent of platform Decimal defaults and absent marks are never object properties", () => {
  const previous = Decimal.precision;
  try {
    Decimal.set({ precision: 2 });
    const sample = golden.cases.find(
      (s: any) => s.name === "recurring-average-cost",
    );
    assert.deepEqual(
      reconcile(
        sample.opening_cash,
        sample.cash_events,
        sample.fills,
        sample.opening_positions,
        sample.marks,
      ),
      sample.expected,
    );
  } finally {
    Decimal.set({ precision: previous });
  }
  const result = reconcile(
    "10",
    [],
    [],
    [{ instrument_id: "constructor", quantity: "1", cost: "1" }],
  );
  assert.equal(result.positions[0].market_value, null);
  assert.equal(result.equity, null);
});

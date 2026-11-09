import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dailyIndicators,
  INDICATOR_VERSION,
} from "../../src/modules/lighttick/investments/market/market.indicators.ts";
const golden = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/lighttick/market-indicators-golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const c of golden.cases)
  test("market indicators preserve legacy decimal60 golden: " + c.name, () => {
    const { algorithm_version, ...actual } = dailyIndicators(c.bars);
    assert.equal(algorithm_version, INDICATOR_VERSION);
    assert.deepEqual(actual, c.expected);
  });
test("indicator duplicates and invalid decimals are rejected without mutating input", () => {
  const bars = golden.cases.find((c: any) => c.name === "records-21").bars,
    copy = structuredClone(bars);
  dailyIndicators(bars);
  assert.deepEqual(bars, copy);
  assert.throws(() => dailyIndicators([bars[0], bars[0]]));
  assert.throws(() => dailyIndicators([{ ...bars[0], close: "0" }]));
});

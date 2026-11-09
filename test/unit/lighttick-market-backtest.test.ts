import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runBacktest,
  BACKTEST_VERSION,
} from "../../src/modules/lighttick/investments/market/backtest.engine.ts";
import { instant } from "../../src/modules/lighttick/investments/market/backtest.validation.ts";
const golden = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/lighttick/market-backtest-golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const c of golden.cases)
  test(
    "built-in backtest preserves fixed legacy execution golden: " + c.name,
    () => {
      const { algorithm_version, input_digest, config, ...actual } =
        runBacktest(c.series, c.config, c.start_at, c.end_at);
      assert.equal(algorithm_version, BACKTEST_VERSION);
      assert.match(input_digest, /^[a-f0-9]{64}$/);
      const expected = structuredClone(c.expected);
      if (expected.algorithm) expected.algorithm = BACKTEST_VERSION;
      assert.deepEqual(actual, expected);
    },
  );
test("backtest forbids arbitrary strategies and unsafe parameters and retains exact microsecond signal order", () => {
  const c = golden.cases[0],
    before = structuredClone(c.series);
  runBacktest(c.series, c.config);
  assert.deepEqual(c.series, before);
  for (const patch of [
    { strategy: "eval(code)" },
    { strategy: "threshold", entry_above: null },
    { quantity: "101" },
    { annual_risk_free: "-1" },
    { commission_rate: "2" },
    { initial_cash: 1000 },
    { code: "process.exit(1)" },
  ])
    assert.throws(() => runBacktest(c.series, { ...c.config, ...patch }));
  assert.ok(
    instant("2026-10-19T09:31:00.000001+08:00") <
      instant("2026-10-19T09:31:00.000002+08:00"),
  );
  assert.equal(
    instant("2026-10-19T09:31:00.000001+08:00"),
    instant("2026-10-19T01:31:00.000001Z"),
  );
  assert.throws(() => instant("2026-10-19T09:31:00"));
  assert.throws(() => instant("2026-02-30T09:31:00Z"));
});

test("over-precision declared limits are incomplete rather than silently rounded to fit native NUMERIC", () => {
  const c = golden.cases[0],
    s = structuredClone(c.series);
  s.bars[0].limit_down = "5.00000000005";
  const r = runBacktest(s, c.config);
  assert.equal(r.status, "incomplete");
  assert.ok(r.missing.includes("0:invalid_bar_or_rules"));
});

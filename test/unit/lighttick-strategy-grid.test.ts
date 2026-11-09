import test from "node:test";
import assert from "node:assert/strict";
import {
  expandCases,
  strategyFields,
} from "../../src/modules/lighttick/investments/strategies/strategy.validation.ts";
import { backtestConfig } from "../../src/modules/lighttick/investments/market/backtest.validation.ts";
const config = backtestConfig({
  strategy: "threshold",
  entry_above: "10",
  exit_below: "9",
});
const definition = {
  id: "inv-strategy-test01",
  revision: 1,
  archive_epoch: 0,
  fields: { name: "Synthetic", description: "Original text", config },
  definition_digest: "a".repeat(64),
  request_key: "original-key",
  archived: false,
  created_at: "2026-11-07T00:00:00Z",
  updated_at: "2026-11-07T00:00:00Z",
};
test("finite grid preserves exact decimal strings and rejects duplicates, cross-family axes and invalid combinations", () => {
  const cases = expandCases(
    "grid",
    [definition],
    [
      { parameter: "entry_above", values: ["10.0000000001", "11"] },
      { parameter: "exit_below", values: ["8", "9"] },
    ],
  );
  assert.equal(cases.length, 4);
  assert.equal(cases[0].config.entry_above, "10.0000000001");
  assert.throws(() =>
    expandCases(
      "grid",
      [definition],
      [{ parameter: "entry_above", values: ["10", "10.0"] }],
    ),
  );
  assert.throws(() =>
    expandCases(
      "grid",
      [definition],
      [{ parameter: "fast_window", values: [1, 2] }],
    ),
  );
  assert.throws(() =>
    expandCases(
      "grid",
      [definition],
      [{ parameter: "entry_above", values: [1] }],
    ),
  );
  assert.throws(() =>
    expandCases(
      "grid",
      [definition],
      Array.from({ length: 3 }, () => ({
        parameter: "entry_above",
        values: ["10"],
      })),
    ),
  );
  assert.throws(() => expandCases("compare", [definition, definition], []));
  assert.throws(() =>
    strategyFields({
      name: "X",
      description: "Y",
      config: { strategy: "threshold" },
    }),
  );
});

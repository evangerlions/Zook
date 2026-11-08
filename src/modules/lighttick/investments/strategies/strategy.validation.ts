import {
  object,
  keys,
  text,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import { investmentId } from "../investment.service.ts";
import { instant } from "../market/backtest.validation.ts";
import { backtestConfig } from "../market/backtest.validation.ts";
import { marketDate, marketNumber } from "../market/market.validation.ts";
import { timestamp as baseTimestamp } from "../screening/screen.validation.ts";
export function timestamp(v: unknown) {
  try {
    const s = baseTimestamp(v);
    instant(s);
    return s;
  } catch {
    fail(422, "Explicit valid timestamp with timezone required.");
  }
}
import type {
  StrategyDefinition,
  StrategyFields,
  RunMode,
  GridAxis,
  StrategyCase,
  ExecutionReview,
} from "./strategy.types.ts";
const configKeys = [
  "initial_cash",
  "quantity",
  "strategy",
  "entry_above",
  "exit_below",
  "fast_window",
  "slow_window",
  "lot_size",
  "price_tick",
  "commission_rate",
  "minimum_commission",
  "sell_tax_rate",
  "slippage_bps",
  "max_participation",
  "annual_periods",
  "annual_risk_free",
];
export function strategyFields(value: unknown): StrategyFields {
  const f = object(value);
  keys(f, ["name", "description", "config"]);
  const c = object(f.config);
  keys(c, configKeys);
  if (configKeys.some((k) => !(k in c)))
    fail(422, "Review every strategy parameter explicitly.");
  return {
    name: text(f.name, 100, true),
    description: text(f.description, 8000),
    config: backtestConfig(c),
  };
}
export function strategyRef(v: unknown) {
  const r = object(v);
  keys(r, ["id", "version", "definition_digest"]);
  if (
    typeof r.definition_digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.definition_digest)
  )
    fail(422, "Exact strategy digest required.");
  return {
    id: investmentId(r.id),
    version: integer(r.version, 1, 100),
    definition_digest: r.definition_digest,
  };
}
export function expandCases(
  mode: RunMode,
  definitions: StrategyDefinition[],
  axesValue: unknown,
): StrategyCase[] {
  if (
    !["single", "compare", "grid"].includes(mode) ||
    !definitions.length ||
    definitions.length > 4
  )
    fail(422, "Select a supported mode and 1..4 exact strategy versions.");
  if (
    new Set(definitions.map((d) => d.id + ":" + d.revision)).size !==
    definitions.length
  )
    fail(422, "Duplicate strategy version.");
  if (mode === "compare" && definitions.length < 2)
    fail(422, "Comparison requires 2..4 exact strategy versions.");
  if (mode !== "compare" && definitions.length !== 1)
    fail(422, "Single/grid require exactly one strategy version.");
  if (
    !Array.isArray(axesValue) ||
    axesValue.length > 2 ||
    (mode === "grid" ? axesValue.length === 0 : axesValue.length !== 0)
  )
    fail(422, "Grid requires 1..2 bounded axes; other modes use none.");
  const axes: GridAxis[] = axesValue.map((v) => {
    const a = object(v);
    keys(a, ["parameter", "values"]);
    const parameter = a.parameter as GridAxis["parameter"];
    const allowed =
      definitions[0].fields.config.strategy === "threshold"
        ? ["entry_above", "exit_below"]
        : ["fast_window", "slow_window"];
    if (
      !allowed.includes(parameter) ||
      !Array.isArray(a.values) ||
      !a.values.length ||
      a.values.length > 4
    )
      fail(422, "Axis must match strategy family and have 1..4 values.");
    const values = a.values.map((v) =>
      parameter.endsWith("window") ? integer(v, 1, 250) : marketNumber(v, true),
    );
    if (new Set(values.map(String)).size !== values.length)
      fail(422, "Duplicate canonical grid value.");
    return { parameter, values };
  });
  if (new Set(axes.map((a) => a.parameter)).size !== axes.length)
    fail(422, "Duplicate grid parameter.");
  let configs = definitions.map((d) => ({
    definition: d,
    config: d.fields.config,
  }));
  for (const a of axes)
    configs = configs.flatMap((c) =>
      a.values.map((v) => ({
        ...c,
        config: backtestConfig({ ...c.config, [a.parameter]: v }),
      })),
    );
  if (configs.length > 16) fail(422, "At most 16 reviewed combinations.");
  return configs.map((c, index) => ({
    index,
    strategy: {
      id: c.definition.id,
      version: c.definition.revision,
      definition_digest: c.definition.definition_digest,
    },
    config: c.config,
  }));
}
export function executionReview(
  value: unknown,
  decision_at: string,
): ExecutionReview | null {
  if (value === null) return null;
  const r = object(value);
  keys(r, ["source_note", "reviewed_at", "facts"]);
  const reviewed_at = timestamp(r.reviewed_at);
  if (
    instant(reviewed_at) > instant(decision_at) ||
    !Array.isArray(r.facts) ||
    r.facts.length > 500
  )
    fail(
      422,
      "Review must be known at decision and contain at most 500 explicit dates.",
    );
  const facts = r.facts.map((v) => {
    const f = object(v);
    keys(f, [
      "date",
      "available_at",
      "suspended",
      "limit_up",
      "limit_down",
      "adj_factor",
      "split_ratio",
      "cash_dividend",
    ]);
    const date = marketDate(f.date),
      available_at = timestamp(f.available_at);
    if (
      typeof f.suspended !== "boolean" ||
      instant(available_at) > instant(reviewed_at) ||
      instant(available_at) < instant(date + "T07:00:00Z")
    )
      fail(
        422,
        "Explicit suspension and historical close availability required.",
      );
    return {
      date,
      available_at,
      suspended: f.suspended,
      limit_up: marketNumber(f.limit_up, true),
      limit_down: marketNumber(f.limit_down, true),
      adj_factor: marketNumber(f.adj_factor, true),
      split_ratio: marketNumber(f.split_ratio, true),
      cash_dividend: marketNumber(f.cash_dividend),
    };
  });
  if (new Set(facts.map((f) => f.date)).size !== facts.length)
    fail(422, "Duplicate execution fact date.");
  return { source_note: text(r.source_note, 4000, true), reviewed_at, facts };
}
export { digest };

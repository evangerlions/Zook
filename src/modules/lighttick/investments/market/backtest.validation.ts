import { LedgerDecimal as D, decimalInput } from "../decimal.ts";
import {
  keys,
  object,
  integer,
} from "../../learning/native-learning.validation.ts";
import { marketError, marketDate } from "./market.validation.ts";
import type { BacktestConfig } from "./backtest.types.ts";
export function backtestConfig(value: unknown): BacktestConfig {
  const b = object(value);
  keys(b, [
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
  ]);
  const string = (k: string, def: string, positive = false) =>
      decimalInput(b[k] ?? def, positive),
    rf = b.annual_risk_free ?? "0";
  if (typeof rf !== "string") marketError("INVALID_BACKTEST_CONFIG", 422);
  const signed = rf.trim().startsWith("-")
    ? new D(decimalInput(rf.trim().slice(1))).negated().toFixed()
    : decimalInput(rf);
  const c: BacktestConfig = {
    initial_cash: string("initial_cash", "100000", true),
    quantity: string("quantity", "100", true),
    strategy: (b.strategy ?? "ma_cross") as BacktestConfig["strategy"],
    entry_above:
      b.entry_above == null ? null : decimalInput(b.entry_above, true),
    exit_below: b.exit_below == null ? null : decimalInput(b.exit_below, true),
    fast_window: integer(b.fast_window ?? 5, 1, 120),
    slow_window: integer(b.slow_window ?? 20, 2, 250),
    lot_size: integer(b.lot_size ?? 100, 1, 10000),
    price_tick: string("price_tick", "0.01", true),
    commission_rate: string("commission_rate", "0.0003"),
    minimum_commission: string("minimum_commission", "5"),
    sell_tax_rate: string("sell_tax_rate", "0.0005"),
    slippage_bps: string("slippage_bps", "10"),
    max_participation: string("max_participation", "0.1", true),
    annual_periods: integer(b.annual_periods ?? 252, 1, 100000),
    annual_risk_free: signed,
  };
  if (
    !["threshold", "ma_cross"].includes(c.strategy) ||
    new D(c.quantity).mod(c.lot_size).gt(0) ||
    new D(c.initial_cash).lt("0.01") ||
    new D(c.price_tick).lt("0.000001") ||
    new D(c.price_tick).gt(1000) ||
    new D(c.max_participation).gt(1) ||
    new D(c.slippage_bps).gt(1000) ||
    new D(c.commission_rate).gt(1) ||
    new D(c.sell_tax_rate).gt(1) ||
    new D(c.annual_risk_free).abs().gte(1) ||
    (c.strategy === "ma_cross" && c.fast_window >= c.slow_window) ||
    (c.strategy === "threshold" && (!c.entry_above || !c.exit_below))
  )
    marketError("INVALID_BACKTEST_CONFIG", 422);
  return c;
}
/** Aware ISO instants retain microsecond ordering instead of truncating to JS milliseconds. */
export function instant(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 40)
    throw Error("Invalid instant");
  const m =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !m ||
    Number(m[2]) > 23 ||
    Number(m[3]) > 59 ||
    Number(m[4]) > 59 ||
    (m[6] !== "Z" &&
      (Number(m[6].slice(1, 3)) > 23 || Number(m[6].slice(4)) > 59))
  )
    throw Error("Invalid instant");
  marketDate(m[1]);
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6]}`);
  if (!Number.isFinite(ms)) throw Error("Invalid instant");
  return BigInt(ms) * 1000n + BigInt((m[5] ?? "").padEnd(6, "0"));
}
export const instantDay = (t: bigint) =>
  new Date(Number(t / 1000n) + 8 * 3600000).toISOString().slice(0, 10);
export function rational(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
type Rational = ReturnType<typeof rational>;
function gcd(a: bigint, b: bigint): bigint {
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}
export function meanExact(values: Rational[]) {
  const sum = values.reduce(
    (a, b) => {
      const g = gcd(a.d, b.d),
        d = (a.d / g) * b.d,
        n = a.n * (b.d / g) + b.n * (a.d / g),
        r = gcd(n, d);
      return { n: n / r, d: d / r };
    },
    { n: 0n, d: 1n },
  );
  return { n: sum.n, d: sum.d * BigInt(values.length) };
}
export const compareExact = (a: Rational, b: Rational) => a.n * b.d - b.n * a.d;

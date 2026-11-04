import { LedgerDecimal as D } from "../decimal.ts";
import { digest } from "../../learning/native-learning.validation.ts";
import { marketError, marketDate, marketNumber } from "./market.validation.ts";
import {
  backtestConfig,
  instant,
  instantDay,
  rational,
  meanExact,
  compareExact,
} from "./backtest.validation.ts";
import { backtestMetrics, metricText } from "./backtest.metrics.ts";
import type {
  ExecutionSeries,
  ExecutionBar,
  EquityPoint,
  BacktestConfig,
} from "./backtest.types.ts";
export const BACKTEST_VERSION = "next-open-long-only-decimal60-v1";
const required = [
  "time",
  "open_at",
  "available_at",
  "open",
  "high",
  "low",
  "close",
  "volume_shares",
  "suspended",
  "limit_up",
  "limit_down",
  "corporate_actions_known",
  "adj_factor",
  "split_ratio",
  "cash_dividend",
] as const;
function missingFacts(s: ExecutionSeries) {
  const missing: string[] = [],
    bars = Array.isArray(s?.bars) ? s.bars : [],
    dates = new Set<string>();
  let last: bigint | null = null;
  if (!bars.length || bars.length > 10000) missing.push("bar_count");
  if (!["day", "minute"].includes(s?.interval))
    missing.push("unsupported_interval");
  if (s?.price_basis !== "unadjusted")
    missing.push("unadjusted_prices_required");
  for (const [i, b] of bars.slice(0, 10000).entries()) {
    if (!b || typeof b !== "object") {
      missing.push(i + ":invalid_bar");
      continue;
    }
    const absent = required.filter((k) => b[k] == null);
    if (absent.length) {
      missing.push(i + ":missing:" + absent.join(","));
      continue;
    }
    try {
      const stamp = instant(b.time),
        opening = instant(b.open_at),
        available = instant(b.available_at);
      if (
        opening > stamp ||
        available < stamp ||
        (last !== null && stamp <= last)
      )
        throw Error();
      last = stamp;
      dates.add(instantDay(stamp));
      if (
        b.corporate_actions_known !== true ||
        typeof b.suspended !== "boolean"
      )
        throw Error();
      for (const k of [
        "open",
        "high",
        "low",
        "close",
        "limit_up",
        "limit_down",
        "adj_factor",
        "split_ratio",
      ] as const)
        marketNumber(b[k], true);
      marketNumber(b.volume_shares);
      marketNumber(b.cash_dividend);
      if (
        new D(b.low).gt(D.min(b.open, b.close)) ||
        new D(b.high).lt(D.max(b.open, b.close)) ||
        new D(b.limit_down).gte(b.limit_up)
      )
        throw Error();
    } catch {
      missing.push(i + ":invalid_bar_or_rules");
    }
  }
  const sessions = Array.isArray(s?.sessions)
    ? s.sessions
    : s?.sessions && typeof s.sessions === "object"
      ? Object.keys(s.sessions)
      : [];
  if (
    !sessions.length ||
    new Set(sessions).size !== dates.size ||
    sessions.some((d) => !dates.has(d))
  )
    missing.push("calendar_gaps");
  if (s?.interval === "minute")
    try {
      const expected = (s.expected_bar_times ?? []).map(instant),
        actual = bars.map((b) => instant(b.time)),
        wanted = new Set(expected);
      if (
        !expected.length ||
        wanted.size !== expected.length ||
        wanted.size !== new Set(actual).size ||
        actual.some((v) => !wanted.has(v))
      )
        missing.push("minute_timeline_gaps_or_missing");
    } catch {
      missing.push("minute_timeline_invalid");
    }
  return missing.slice(0, 50);
}
const incomplete = (
  missing: string[],
  trades: Record<string, unknown>[] = [],
  orders: Record<string, unknown>[] = [],
  equity: EquityPoint[] = [],
) => ({
  status: "incomplete" as const,
  missing,
  metrics: null,
  trades,
  orders,
  equity,
});
const text = (v: InstanceType<typeof D>) => {
  const s = metricText(v);
  if (s === null) marketError("BACKTEST_NUMERIC_RANGE", 422);
  return s;
};
function simulate(
  series: ExecutionSeries,
  c: BacktestConfig,
  start: string | null,
  end: string | null,
) {
  const missing = missingFacts(series);
  if (missing.length) return incomplete(missing);
  let cash = new D(c.initial_cash),
    quantity = new D(0),
    basis = new D(0),
    costs = new D(0),
    cycleNet = new D(0),
    opened: bigint | null = null;
  type Pending = {
    side: "buy" | "sell";
    signal_at: string;
    signal_bar: string;
  };
  let pending: Pending | null = null;
  const initial = cash,
    trades: Record<string, unknown>[] = [],
    orders: Record<string, unknown>[] = [],
    points: EquityPoint[] = [],
    closed: { net: InstanceType<typeof D>; days: number }[] = [],
    closes: ReturnType<typeof rational>[] = [],
    availability: bigint[] = [];
  let previous: {
    fast: ReturnType<typeof rational>;
    slow: ReturnType<typeof rational>;
    known: bigint;
  } | null = null;
  for (const b of series.bars) {
    const stamp = instant(b.time),
      opening = instant(b.open_at),
      available = instant(b.available_at),
      day = instantDay(stamp);
    if (end && day > end) break;
    const live = !start || day >= start,
      price = new D(b.close),
      adjusted = rational(price.mul(b.adj_factor).toFixed());
    if (live && !quantity.isZero()) {
      cash = cash.plus(quantity.mul(b.cash_dividend));
      cycleNet = cycleNet.plus(quantity.mul(b.cash_dividend));
      quantity = quantity.mul(b.split_ratio);
      if (!quantity.isInteger())
        return incomplete(
          ["fractional_corporate_action_requires_cash_in_lieu"],
          trades,
          orders,
          points,
        );
      text(quantity);
    }
    if (pending && live) {
      const side = pending.side,
        raw = new D(b.open),
        volume = new D(b.volume_shares);
      let reason: string | null = null,
        filled = new D(0);
      if (instant(pending.signal_at) > opening)
        reason = "signal_not_known_at_open";
      else if (b.suspended) reason = "suspended";
      else if (volume.lte(0)) reason = "no_volume";
      else if (
        side === "sell" &&
        opened !== null &&
        instantDay(opening) <= instantDay(opened)
      )
        reason = "t_plus_one";
      else if (side === "buy" && raw.gte(b.limit_up)) reason = "limit_up";
      else if (side === "sell" && raw.lte(b.limit_down)) reason = "limit_down";
      const tick = new D(c.price_tick),
        slip = new D(c.slippage_bps).div(10000),
        execution = raw
          .mul(side === "buy" ? slip.plus(1) : new D(1).minus(slip))
          .div(tick)
          .toDecimalPlaces(0, side === "buy" ? D.ROUND_CEIL : D.ROUND_FLOOR)
          .mul(tick);
      if (
        reason === null &&
        (execution.gt(b.high) ||
          execution.lt(b.low) ||
          execution.gt(b.limit_up) ||
          execution.lt(b.limit_down))
      )
        reason = "slippage_outside_bar_or_limits";
      if (reason === null) {
        const lot = new D(c.lot_size),
          capacity = volume.mul(c.max_participation).div(lot).floor().mul(lot),
          wanted = side === "buy" ? new D(c.quantity) : quantity;
        if (side === "buy") {
          let upper = BigInt(
              D.min(
                wanted,
                capacity,
                cash.div(execution).div(lot).floor().mul(lot),
              )
                .div(lot)
                .floor()
                .toFixed(),
            ),
            low = 0n;
          while (low < upper) {
            const candidate = (low + upper + 1n) / 2n,
              gross = execution.mul(lot).mul(candidate.toString()),
              charge = D.max(
                c.minimum_commission,
                gross.mul(c.commission_rate),
              ).toDecimalPlaces(2, D.ROUND_HALF_UP);
            if (gross.plus(charge).lte(cash)) low = candidate;
            else upper = candidate - 1n;
          }
          filled = new D(low.toString()).mul(lot);
        } else
          filled = D.min(wanted, capacity.lt(quantity) ? capacity : quantity);
        if (filled.lte(0)) reason = "cash_or_participation_limit";
      }
      if (reason === null) {
        const gross = execution.mul(filled),
          fee = D.max(
            c.minimum_commission,
            gross.mul(c.commission_rate),
          ).toDecimalPlaces(2, D.ROUND_HALF_UP),
          tax =
            side === "sell"
              ? gross.mul(c.sell_tax_rate).toDecimalPlaces(2, D.ROUND_HALF_UP)
              : new D(0);
        if (side === "buy") {
          cash = cash.minus(gross.plus(fee));
          quantity = quantity.plus(filled);
          basis = gross.plus(fee);
          opened = opening;
          cycleNet = gross.plus(fee).negated();
        } else {
          cash = cash.plus(gross.minus(fee).minus(tax));
          const allocated = basis.mul(filled).div(quantity);
          basis = basis.minus(allocated);
          quantity = quantity.minus(filled);
          cycleNet = cycleNet.plus(gross.minus(fee).minus(tax));
          if (quantity.isZero()) {
            closed.push({
              net: cycleNet,
              days:
                (Date.parse(instantDay(opening)) -
                  Date.parse(instantDay(opened!))) /
                86400000,
            });
            opened = null;
            basis = new D(0);
          }
        }
        costs = costs.plus(fee).plus(tax);
        trades.push({
          side,
          time: b.open_at,
          signal_at: pending.signal_at,
          price: text(execution),
          quantity: text(filled),
          fee: text(fee),
          tax: text(tax),
          cash_after: text(cash),
          position_after: text(quantity),
        });
      }
      orders.push({
        ...pending,
        execution_at: b.open_at,
        status: reason === null ? "filled" : "rejected",
        reason: reason ?? "next_open",
        filled_quantity: text(filled),
      });
      pending = null;
    }
    closes.push(adjusted);
    availability.push(available);
    const means = () => ({
      fast: meanExact(closes.slice(-c.fast_window)),
      slow: meanExact(closes.slice(-c.slow_window)),
      known: availability
        .slice(-c.slow_window)
        .reduce((a, b) => (a > b ? a : b)),
    });
    if (live) {
      points.push({
        time: b.time,
        equity: text(cash.plus(quantity.mul(price))),
        cash: text(cash),
        quantity: text(quantity),
        close: b.close,
      });
      let enter = false,
        exit = false;
      if (!b.suspended) {
        if (c.strategy === "threshold") {
          enter = price.gt(c.entry_above!);
          exit = price.lt(c.exit_below!);
        } else if (closes.length >= c.slow_window) {
          const m = means();
          if (m.known <= available && previous && previous.known <= available) {
            enter =
              compareExact(previous.fast, previous.slow) <= 0n &&
              compareExact(m.fast, m.slow) > 0n;
            exit =
              compareExact(previous.fast, previous.slow) >= 0n &&
              compareExact(m.fast, m.slow) < 0n;
          }
          previous = m;
        }
      }
      if (quantity.isZero() && enter)
        pending = {
          side: "buy",
          signal_at: b.available_at,
          signal_bar: b.time,
        };
      else if (quantity.gt(0) && exit)
        pending = {
          side: "sell",
          signal_at: b.available_at,
          signal_bar: b.time,
        };
    } else if (c.strategy === "ma_cross" && closes.length >= c.slow_window)
      previous = means();
  }
  if (pending)
    orders.push({
      ...pending,
      status: "unexecuted",
      reason: "no_next_open",
      filled_quantity: "0",
    });
  return {
    status: "complete" as const,
    missing: [],
    algorithm: BACKTEST_VERSION,
    execution_assumptions:
      "declared point-in-time rules; no shorting or forced final liquidation",
    final_cash: text(cash),
    open_quantity: text(quantity),
    open_cost_basis: text(basis),
    trades,
    orders,
    equity: points,
    metrics: backtestMetrics(points, initial, closed, costs, c),
    limitations: [
      "输入的历史时点、公司行动和交易状态按本人来源声明，软件不构成独立真实性核验。",
      "未平仓按末次收盘估值；费用与年化周期为本次配置假设。",
    ],
  };
}
/** Bounded CPU work: call from the existing worker with frozen inputs, outside owner transactions. */
export function runBacktest(
  series: ExecutionSeries,
  config: unknown,
  startAt: string | null = null,
  endAt: string | null = null,
) {
  if (Buffer.byteLength(JSON.stringify(series)) > 8 * 1024 * 1024)
    marketError("BACKTEST_INPUT_TOO_LARGE", 422);
  const c = backtestConfig(config);
  if (startAt) marketDate(startAt);
  if (endAt) marketDate(endAt);
  if (startAt && endAt && startAt > endAt) marketError("INVALID_RANGE", 422);
  const result = {
    ...simulate(series, c, startAt, endAt),
    input_digest: digest({
      series,
      config: c,
      start_at: startAt,
      end_at: endAt,
    }),
    algorithm_version: BACKTEST_VERSION,
    config: c,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024)
    marketError("BACKTEST_OUTPUT_TOO_LARGE", 422);
  return result;
}

import { LedgerDecimal as D } from "../decimal.ts";
import type { Decimal } from "decimal.js";
import type { BacktestConfig, EquityPoint } from "./backtest.types.ts";
export function metricText(v: Decimal | null) {
  if (v === null || !v.isFinite() || (!v.isZero() && (v.e > 80 || v.e < -100)))
    return null;
  return v.toFixed();
}
export function backtestMetrics(
  points: EquityPoint[],
  initial: Decimal,
  closed: { net: Decimal; days: number }[],
  costs: Decimal,
  c: BacktestConfig,
) {
  const values = [initial, ...points.map((p) => new D(p.equity))],
    last = values.at(-1)!,
    returns = values
      .slice(1)
      .flatMap((b, i) => (values[i].gt(0) ? [b.div(values[i]).minus(1)] : [])),
    n = returns.length,
    sum = (a: Decimal[]) => a.reduce((v, x) => v.plus(x), new D(0));
  const mean = n ? sum(returns).div(n) : null,
    variance =
      n > 1 ? sum(returns.map((r) => r.minus(mean!).pow(2))).div(n - 1) : null,
    sd = variance?.sqrt() ?? null,
    period = new D(c.annual_periods),
    rf = new D(c.annual_risk_free).plus(1).pow(new D(1).div(period)).minus(1),
    downside = n
      ? sum(returns.map((r) => D.min(r.minus(rf), 0).pow(2)))
          .div(n)
          .sqrt()
      : null;
  let peak = initial,
    drawdown = new D(0);
  for (const p of points) {
    const equity = new D(p.equity);
    peak = D.max(peak, equity);
    const decline = peak.isZero() ? new D(0) : equity.div(peak).minus(1);
    p.drawdown_pct = metricText(decline.mul(100));
    drawdown = D.min(drawdown, decline);
  }
  const wins = closed.filter((v) => v.net.gt(0)),
    losses = closed.filter((v) => v.net.lt(0));
  let annualized: string | null = null;
  if (n > 1 && last.gt(0)) {
    const log = last.div(initial).ln().mul(period).div(n);
    if (log.abs().lte(100))
      annualized = metricText(log.exp().minus(1).mul(100));
  }
  return {
    net_profit: metricText(last.minus(initial)),
    total_return_pct: metricText(last.div(initial).minus(1).mul(100)),
    annualized_return_pct: annualized,
    maximum_drawdown_pct: metricText(drawdown.negated().mul(100)),
    volatility_pct:
      sd === null ? null : metricText(sd.mul(period.sqrt()).mul(100)),
    sharpe:
      sd && !sd.isZero()
        ? metricText(mean!.minus(rf).div(sd).mul(period.sqrt()))
        : null,
    sortino:
      downside && !downside.isZero() && n > 1
        ? metricText(mean!.minus(rf).div(downside).mul(period.sqrt()))
        : null,
    closed_round_trips: closed.length,
    win_rate_pct: closed.length
      ? metricText(new D(wins.length).mul(100).div(closed.length))
      : null,
    average_win: wins.length
      ? metricText(sum(wins.map((w) => w.net)).div(wins.length))
      : null,
    average_loss: losses.length
      ? metricText(sum(losses.map((w) => w.net)).div(losses.length))
      : null,
    largest_win: wins.length
      ? metricText(D.max(...wins.map((w) => w.net)))
      : null,
    largest_loss: losses.length
      ? metricText(D.min(...losses.map((w) => w.net)))
      : null,
    average_holding_calendar_days: closed.length
      ? metricText(
          new D(closed.reduce((n, v) => n + v.days, 0)).div(closed.length),
        )
      : null,
    total_fees_and_tax: metricText(costs),
    benchmark_return_pct: null,
    risk_metric_samples: n,
    annual_periods: c.annual_periods,
    annual_risk_free: c.annual_risk_free,
  };
}

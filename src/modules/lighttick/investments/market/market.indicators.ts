import { LedgerDecimal as D, decimalString } from "../decimal.ts";
import type { DailyBar } from "./market.types.ts";
import { marketNumber, marketError, marketDate } from "./market.validation.ts";
export const INDICATOR_VERSION =
  "daily-record-ma-atr-std-decimal60-half-even-v1";
/** Same bounded record-based statistics as legacy; never assumes adjacent records are adjacent sessions. */
export function dailyIndicators(bars: DailyBar[]) {
  if (
    bars.length > 1000 ||
    new Set(bars.map((b) => b.date)).size !== bars.length
  )
    marketError("INDICATOR_INPUT_INVALID", 422);
  const ordered = [...bars].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const b of ordered) {
    marketDate(b.date);
    if (
      new D(b.low).gt(D.min(b.open, b.close)) ||
      new D(b.high).lt(D.max(b.open, b.close))
    )
      marketError("INVALID_OHLC");
    for (const k of ["open", "high", "low", "close"] as const)
      marketNumber(b[k], true);
    marketNumber(b.volume_shares);
  }
  const sum = (a: InstanceType<typeof D>[]) =>
    a.reduce((n, v) => n.plus(v), new D(0));
  const result: {
    price_basis: "unadjusted";
    algorithm_version: string;
    ma5: string | null;
    ma20: string | null;
    volume_ratio_5: string | null;
    atr14: string | null;
    record_return_std20: string | null;
    return_sample_count: number;
    limitations: string[];
  } = {
    price_basis: "unadjusted",
    algorithm_version: INDICATOR_VERSION,
    ma5: null,
    ma20: null,
    volume_ratio_5: null,
    atr14: null,
    record_return_std20: null,
    return_sample_count: Math.max(0, Math.min(20, ordered.length - 1)),
    limitations: [
      "未复权；除权与公司行动可能影响指标，不能据此推定可执行交易。",
      "ATR为最近14条真实区间的简单均值；波动为20次相邻有效记录收益样本标准差，不年化，不保证相邻自然日开市。",
    ],
  };
  for (const n of [5, 20] as const)
    if (ordered.length >= n)
      result[n === 5 ? "ma5" : "ma20"] = decimalString(
        sum(ordered.slice(-n).map((b) => new D(b.close))).div(n),
      );
  if (ordered.length >= 6) {
    const previous = sum(
      ordered.slice(-6, -1).map((b) => new D(b.volume_shares)),
    ).div(5);
    if (!previous.isZero())
      result.volume_ratio_5 = decimalString(
        new D(ordered.at(-1)!.volume_shares).div(previous),
      );
  }
  if (ordered.length >= 15) {
    const recent = ordered.slice(-15),
      ranges = recent
        .slice(1)
        .map((b, i) =>
          D.max(
            new D(b.high).minus(b.low),
            new D(b.high).minus(recent[i].close).abs(),
            new D(b.low).minus(recent[i].close).abs(),
          ),
        );
    result.atr14 = decimalString(sum(ranges).div(14));
  }
  if (ordered.length >= 21) {
    const recent = ordered.slice(-21),
      returns = recent
        .slice(1)
        .map((b, i) => new D(b.close).div(recent[i].close).minus(1)),
      mean = sum(returns).div(20);
    result.record_return_std20 = decimalString(
      sum(returns.map((v) => v.minus(mean).pow(2)))
        .div(19)
        .sqrt(),
    );
  }
  return result;
}

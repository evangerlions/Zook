import { LedgerDecimal as D, decimalInput } from "../decimal.ts";
import type { DailyBar, DailyRequest } from "./market.types.ts";
export class MarketDataError extends Error {
  readonly code: string;
  constructor(
    readonly reason: string,
    readonly statusCode = 502,
  ) {
    super(
      "Market data " +
        reason.toLowerCase() +
        ". The selected source was not replaced; no data was published.",
    );
    this.name = "MarketDataError";
    this.code = "LIGHTTICK_MARKET_" + reason;
  }
}
export function marketError(reason: string, status = 502): never {
  throw new MarketDataError(reason, status);
}
export function marketDate(v: unknown) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v < "0001-01-01" ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    marketError("INVALID_DATE", 422);
  return v;
}
export function shanghaiClock(now: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}
export function dailyRequest(r: DailyRequest, now: Date) {
  marketDate(r.start);
  marketDate(r.end);
  if (
    r.start > r.end ||
    Date.parse(r.end) - Date.parse(r.start) > 369 * 86400000
  )
    marketError("INVALID_RANGE", 422);
  if (
    !["SSE", "SZSE"].includes(r.instrument.market) ||
    !["stock", "etf"].includes(r.instrument.kind) ||
    !/^\d{6}$/.test(r.instrument.code)
  )
    marketError("UNSUPPORTED_IDENTITY", 422);
  if (
    r.instrument.kind === "stock" &&
    !(
      r.instrument.market === "SSE"
        ? ["600", "601", "603", "605", "688"]
        : ["000", "001", "002", "003", "300", "301"]
    ).includes(r.instrument.code.slice(0, 3))
  )
    marketError("UNSUPPORTED_IDENTITY", 422);
  if (
    r.instrument.kind === "etf" &&
    !(r.instrument.market === "SSE" ? /^5\d{5}$/ : /^15\d{4}$/).test(
      r.instrument.code,
    )
  )
    marketError("UNSUPPORTED_IDENTITY", 422);
  if (r.end > shanghaiClock(now).slice(0, 10)) marketError("FUTURE_DATE", 422);
}
export function marketNumber(v: unknown, positive = false): string {
  try {
    return decimalInput(v, positive);
  } catch {
    marketError("INVALID_DECIMAL");
  }
}
export function normalizeBar(
  raw: Record<string, unknown>,
  r: DailyRequest,
  now: Date,
  volumeFactor: string,
  amountFactor: string,
): DailyBar {
  const date = marketDate(raw.date),
    stamp = shanghaiClock(now);
  if (
    date < r.start ||
    date > r.end ||
    date > stamp.slice(0, 10) ||
    (date === stamp.slice(0, 10) && stamp.slice(11) < "15:30")
  )
    marketError("INCOMPLETE_OR_OUTSIDE_DATE");
  const open = marketNumber(raw.open, true),
    high = marketNumber(raw.high, true),
    low = marketNumber(raw.low, true),
    close = marketNumber(raw.close, true);
  if (new D(low).gt(D.min(open, close)) || new D(high).lt(D.max(open, close)))
    marketError("INVALID_OHLC");
  const scaled = (v: unknown, factor: string) => {
    const out = new D(marketNumber(v)).mul(factor).toFixed();
    return marketNumber(out);
  };
  return {
    date,
    open,
    high,
    low,
    close,
    volume_shares: scaled(raw.volume, volumeFactor),
    amount_cny: scaled(raw.amount, amountFactor),
    turnover_rate_pct:
      raw.turnover_rate_pct == null || raw.turnover_rate_pct === ""
        ? null
        : marketNumber(raw.turnover_rate_pct),
  };
}
export function orderedBars(bars: DailyBar[]) {
  if (!bars.length) marketError("EMPTY_DATA", 422);
  if (
    bars.length > 1000 ||
    new Set(bars.map((b) => b.date)).size !== bars.length
  )
    marketError("DUPLICATE_OR_TOO_MANY_ROWS");
  return bars.sort((a, b) => (a.date < b.date ? -1 : 1));
}

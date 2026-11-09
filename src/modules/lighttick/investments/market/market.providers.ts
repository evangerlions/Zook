import type { DailyRequest } from "./market.types.ts";
import { marketError, normalizeBar, marketDate } from "./market.validation.ts";
import { marketJson } from "./lossless-json.ts";
import { MarketTransport } from "./market.transport.ts";
export const PROVIDER_VERSIONS = {
  csv: "csv-daily-decimal-v1",
  tushare: "tushare-daily-http-decimal-v1",
  eastmoney: "eastmoney-daily-direct-decimal-v1",
  tencent: "tencent-day-direct-decimal-v1",
} as const;
export function providerRows(packet: any) {
  const d = packet?.data;
  if (String(packet?.code) !== "0") marketError("PROVIDER_PERMISSION", 422);
  if (
    !Array.isArray(d?.fields) ||
    !d.fields.length ||
    d.fields.length > 32 ||
    new Set(d.fields).size !== d.fields.length ||
    d.fields.some((v: any) => typeof v !== "string") ||
    !Array.isArray(d.items) ||
    d.items.length > 1000
  )
    marketError("INVALID_FIELDS");
  return d.items.map((row: any) => {
    if (!Array.isArray(row) || row.length !== d.fields.length)
      marketError("INVALID_ROW");
    return Object.fromEntries(
      d.fields.map((k: string, i: number) => [k, row[i]]),
    );
  }) as Record<string, unknown>[];
}
export async function tushareDaily(
  r: DailyRequest,
  now: Date,
  token: string,
  transport: MarketTransport,
  signal: AbortSignal,
) {
  if (
    typeof token !== "string" ||
    token.length < 8 ||
    token.length > 4096 ||
    /[\x00-\x20]/.test(token)
  )
    marketError("CREDENTIAL_UNAVAILABLE", 503);
  const code =
      r.instrument.code + (r.instrument.market === "SSE" ? ".SH" : ".SZ"),
    compact = (v: string) => v.replaceAll("-", "");
  const request = async (
    api_name: string,
    params: Record<string, string>,
    fields: string,
  ) =>
    providerRows(
      marketJson(
        await transport.text(
          "https://api.tushare.pro",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_name, params, fields, token }),
          },
          signal,
        ),
      ),
    );
  const calendar = await request(
    "trade_cal",
    {
      exchange: r.instrument.market,
      start_date: compact(r.start),
      end_date: compact(r.end),
    },
    "exchange,cal_date,is_open",
  );
  const sessions: Record<string, boolean> = {};
  for (const c of calendar) {
    const day = String(c.cal_date).replace(
      /^(\d{4})(\d{2})(\d{2})$/,
      "$1-$2-$3",
    );
    marketDate(day);
    if (
      c.exchange !== r.instrument.market ||
      day < r.start ||
      day > r.end ||
      !["0", "1"].includes(String(c.is_open)) ||
      Object.hasOwn(sessions, day)
    )
      marketError("INVALID_PROVIDER_CALENDAR");
    sessions[day] = String(c.is_open) === "1";
  }
  for (let d = Date.parse(r.start); d <= Date.parse(r.end); d += 86400000)
    if (!Object.hasOwn(sessions, new Date(d).toISOString().slice(0, 10)))
      marketError("INCOMPLETE_PROVIDER_CALENDAR");
  const raw = await request(
    r.instrument.kind === "etf" ? "fund_daily" : "daily",
    { ts_code: code, start_date: compact(r.start), end_date: compact(r.end) },
    "ts_code,trade_date,open,high,low,close,vol,amount",
  );
  const bars = raw.map((row) => {
    if (row.ts_code !== code) marketError("WRONG_INSTRUMENT");
    const day = String(row.trade_date).replace(
      /^(\d{4})(\d{2})(\d{2})$/,
      "$1-$2-$3",
    );
    if (!sessions[day]) marketError("CLOSED_PROVIDER_SESSION");
    return normalizeBar(
      {
        date: day,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.vol,
        amount: row.amount,
      },
      r,
      now,
      "100",
      "1000",
    );
  });
  return {
    bars,
    units: { volume: "lots100", amount: "thousand_CNY" },
    calendar: {
      status: "available",
      market: r.instrument.market,
      mode: "provider",
      supplier: "tushare",
      endpoint: "trade_cal",
      version: PROVIDER_VERSIONS.tushare,
      start: r.start,
      end: r.end,
      sessions,
    },
  };
}
export async function eastmoneyDaily(
  r: DailyRequest,
  now: Date,
  transport: MarketTransport,
  signal: AbortSignal,
) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.search = new URLSearchParams({
    secid: (r.instrument.market === "SSE" ? "1." : "0.") + r.instrument.code,
    klt: "101",
    fqt: "0",
    beg: r.start.replaceAll("-", ""),
    end: r.end.replaceAll("-", ""),
    lmt: "1000",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
  }).toString();
  const packet = marketJson(
      await transport.text(url.toString(), { method: "GET" }, signal),
    ),
    d = packet?.data;
  if (
    String(packet?.rc) !== "0" ||
    d?.code !== r.instrument.code ||
    String(d.market) !== (r.instrument.market === "SSE" ? "1" : "0") ||
    !Array.isArray(d.klines) ||
    d.klines.length > 1000
  )
    marketError("INVALID_EASTMONEY_PACKET");
  const bars = d.klines.map((value: any) => {
    if (typeof value !== "string") marketError("INVALID_EASTMONEY_ROW");
    const f = value.split(",");
    if (f.length !== 11) marketError("INVALID_EASTMONEY_ROW");
    return normalizeBar(
      {
        date: f[0],
        open: f[1],
        close: f[2],
        high: f[3],
        low: f[4],
        volume: f[5],
        amount: f[6],
        turnover_rate_pct: f[10],
      },
      r,
      now,
      "100",
      "1",
    );
  });
  return { bars, units: { volume: "lots100", amount: "CNY" } };
}
export async function tencentDaily(
  r: DailyRequest,
  now: Date,
  transport: MarketTransport,
  signal: AbortSignal,
) {
  if (
    r.instrument.kind !== "stock" ||
    ![
      "000",
      "001",
      "002",
      "003",
      "300",
      "301",
      "600",
      "601",
      "603",
      "605",
      "688",
    ].includes(r.instrument.code.slice(0, 3))
  )
    marketError("TENCENT_UNSUPPORTED_IDENTITY", 422);
  const symbol =
      (r.instrument.market === "SSE" ? "sh" : "sz") + r.instrument.code,
    url = new URL(
      "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get",
    );
  url.searchParams.set("param", `${symbol},day,${r.start},${r.end},640,`);
  const packet = marketJson(
      await transport.text(url.toString(), { method: "GET" }, signal),
    ),
    raw = packet?.data?.[symbol]?.day;
  if (String(packet?.code) !== "0" || !Array.isArray(raw) || raw.length > 1000)
    marketError("INVALID_TENCENT_PACKET");
  const bars = raw.flatMap((f: any) => {
    if (!Array.isArray(f) || f.length < 9 || typeof f[0] !== "string")
      marketError("INVALID_TENCENT_ROW");
    if (f[0] < r.start || f[0] > r.end) return [];
    return [
      normalizeBar(
        {
          date: f[0],
          open: f[1],
          close: f[2],
          high: f[3],
          low: f[4],
          volume: f[5],
          amount: f[8],
        },
        r,
        now,
        r.instrument.code.startsWith("688") ? "1" : "100",
        "10000",
      ),
    ];
  });
  return {
    bars,
    units: {
      volume: r.instrument.code.startsWith("688") ? "shares" : "lots100",
      amount: "ten_thousand_CNY",
    },
  };
}

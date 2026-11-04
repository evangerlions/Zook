import { digest } from "../../learning/native-learning.validation.ts";
import { marketDate, shanghaiClock, marketError } from "./market.validation.ts";
export const CALENDAR_VERSION = "cn-exchanges-2026-reviewed-20261105-v1";
const holidays = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
];
export const CALENDAR_SOURCES = {
  SSE: "https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml",
  SZSE: "https://www.szse.cn/disclosure/notice/general/t20251222_618087.html",
};
export interface MarketCalendar {
  status: "available" | "coverage_unknown" | "review_expired";
  market: string;
  version: string;
  start: string;
  end: string;
  reviewed_on: string;
  review_until: string;
  source_url: string | null;
  sessions: Record<string, boolean>;
  snapshot_hash: string;
}
export function referenceCalendar(
  market: string,
  start: string,
  end: string,
  now: Date,
): MarketCalendar {
  marketDate(start);
  marketDate(end);
  if (start > end || Date.parse(end) - Date.parse(start) > 369 * 86400000)
    marketError("INVALID_RANGE", 422);
  const today = shanghaiClock(now).slice(0, 10),
    source = CALENDAR_SOURCES[market as keyof typeof CALENDAR_SOURCES] ?? null;
  const status =
    !source ||
    start < "2026-01-01" ||
    end > "2026-12-31" ||
    today < "2025-12-22"
      ? "coverage_unknown"
      : today > "2026-11-27"
        ? "review_expired"
        : "available";
  const sessions: Record<string, boolean> = {};
  if (status === "available")
    for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
      const d = new Date(t),
        date = d.toISOString().slice(0, 10);
      sessions[date] =
        ![0, 6].includes(d.getUTCDay()) &&
        !holidays.some(([a, b]) => a <= date && date <= b);
    }
  const result = {
    status,
    market,
    version: CALENDAR_VERSION,
    start,
    end,
    reviewed_on: "2026-11-05",
    review_until: "2026-11-27",
    source_url: source,
    sessions,
  } as const;
  return { ...result, snapshot_hash: digest(result) };
}

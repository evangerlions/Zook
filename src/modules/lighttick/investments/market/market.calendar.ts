import { digest } from "../../learning/native-learning.validation.ts";
import { marketDate, shanghaiClock, marketError } from "./market.validation.ts";
// 2026-11-28 复核：沪深 2026 节假日表与交易所公告一致，复核期延到本年末。
// review_until 是应用维护期限，不是交易所公告失效日；到期后一律按「未知」处理。
export const CALENDAR_VERSION = "cn-exchanges-2026-reviewed-20261128-v1";
const holidays = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
];
/** 覆盖边界与复核期限必须是同一份常量：此前 status 判定里另写了一份字面量，
    改 review_until 不会生效，日历该恢复的日子仍然判 review_expired。 */
const CALENDAR_FIRST_DATE = "2026-01-01";
const CALENDAR_LAST_DATE = "2026-12-31";
const REVIEWED_ON = "2026-11-28";
const REVIEW_UNTIL = "2026-12-31";
/** 早于交易所公告发布（2025-12-22）的「今天」拿不到可信日历。 */
const REVIEW_TRUSTED_FROM = "2025-12-22";
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
    start < CALENDAR_FIRST_DATE ||
    end > CALENDAR_LAST_DATE ||
    today < REVIEW_TRUSTED_FROM
      ? "coverage_unknown"
      : today > REVIEW_UNTIL
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
    reviewed_on: REVIEWED_ON,
    review_until: REVIEW_UNTIL,
    source_url: source,
    sessions,
  } as const;
  return { ...result, snapshot_hash: digest(result) };
}

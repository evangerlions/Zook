import { digest } from "../../learning/native-learning.validation.ts";
import type {
  DailyBar,
  DailyDataset,
  DailySupplier,
  DailyRequest,
  MarketPolicyResolver,
} from "./market.types.ts";
import {
  dailyRequest,
  marketError,
  orderedBars,
  shanghaiClock,
} from "./market.validation.ts";
import { referenceCalendar } from "./market.calendar.ts";
import { csvDaily } from "./market.csv.ts";
import {
  tushareDaily,
  eastmoneyDaily,
  tencentDaily,
  PROVIDER_VERSIONS,
} from "./market.providers.ts";
import { MarketTransport } from "./market.transport.ts";
/** Only server policy resolves credentials. Exactly one explicitly selected supplier is called. */
export class DailyMarketAdapter {
  constructor(
    readonly policy: MarketPolicyResolver,
    readonly transport = new MarketTransport(),
    readonly clock = () => new Date(),
  ) {}
  async read(
    supplier: DailySupplier,
    r: DailyRequest,
    signal: AbortSignal,
  ): Promise<DailyDataset> {
    if (!["csv", "tushare", "eastmoney", "tencent"].includes(supplier))
      marketError("UNKNOWN_SUPPLIER", 422);
    if (signal.aborted) marketError("CANCELLED");
    const now = this.clock();
    dailyRequest(r, now);
    const policy = { ...(await this.policy(supplier)) };
    if (!policy.enabled) marketError("SUPPLIER_DISABLED", 503);
    if (
      typeof policy.revision !== "string" ||
      !policy.revision ||
      policy.revision.length > 100
    )
      marketError("POLICY_UNAVAILABLE", 503);
    const data: {
      bars: DailyBar[];
      units: { volume: string; amount: string };
      calendar?: Record<string, any>;
    } =
      supplier === "csv"
        ? csvDaily(r, now)
        : supplier === "tushare"
          ? await tushareDaily(
              r,
              now,
              policy.tushare_token ?? "",
              this.transport,
              signal,
            )
          : supplier === "eastmoney"
            ? await eastmoneyDaily(r, now, this.transport, signal)
            : await tencentDaily(r, now, this.transport, signal);
    if (signal.aborted) marketError("CANCELLED");
    const current = await this.policy(supplier);
    if (
      !current.enabled ||
      current.revision !== policy.revision ||
      (supplier === "tushare" && current.tushare_token !== policy.tushare_token)
    )
      marketError("POLICY_CHANGED", 409);
    const completed = new Date(Math.max(now.getTime(), this.clock().getTime()));
    const bars = orderedBars(data.bars),
      reference = referenceCalendar(
        r.instrument.market,
        r.start,
        r.end,
        completed,
      ),
      calendar = data.calendar ?? reference;
    const sessions = calendar.sessions as Record<string, boolean>,
      available = calendar.status === "available";
    if (available && bars.some((b) => sessions[b.date] !== true))
      marketError("CLOSED_CALENDAR_SESSION");
    if (
      data.calendar &&
      reference.status === "available" &&
      Object.entries(reference.sessions).some(
        ([day, open]) => sessions[day] !== open,
      )
    )
      marketError("CALENDAR_DISAGREEMENT");
    const stamp = shanghaiClock(now),
      seen = new Set(bars.map((b) => b.date)),
      missing = available
        ? Object.entries(sessions)
            .filter(
              ([day, open]) =>
                open &&
                (day < stamp.slice(0, 10) ||
                  (day === stamp.slice(0, 10) && stamp.slice(11) >= "15:30")) &&
                !seen.has(day),
            )
            .map(([day]) => day)
            .sort()
        : null;
    const result = {
      supplier,
      adapter_version: PROVIDER_VERSIONS[supplier],
      policy_revision: policy.revision,
      instrument_id: r.instrument.id,
      code: r.instrument.code,
      market: r.instrument.market,
      kind: r.instrument.kind,
      start: r.start,
      end: r.end,
      price_basis: "unadjusted" as const,
      realtime: false as const,
      retrieved_at: completed.toISOString(),
      available_at: completed.toISOString(),
      source_units: data.units,
      calendar: { ...calendar },
      missing_sessions: missing,
      bars,
      ...(supplier === "csv"
        ? {
            declared_source: r.declared_source!.trim(),
            raw_input_digest: digest(r.csv),
          }
        : {}),
      limitations: [
        "历史数据本次才取得，不证明历史时点已可用；不作为事前证据。",
        "未复权，未确认公司行动、上市身份、实时状态或成交资格。",
        "缺少日线不等于零价格或停牌，不自动填充记录。",
        ...(available ? [] : ["交易日历未覆盖或复核已过期，缺失交易日未知。"]),
        ...(supplier === "csv"
          ? ["CSV 来源与单位由本人声明，未经供应商独立核验。"]
          : []),
      ],
    };
    return { ...result, input_digest: digest(result) };
  }
}

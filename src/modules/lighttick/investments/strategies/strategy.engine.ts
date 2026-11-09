import { runBacktest, BACKTEST_VERSION } from "../market/backtest.engine.ts";
import { digest } from "../../learning/native-learning.validation.ts";
import type {
  BacktestInput,
  BacktestReport,
  CaseResult,
} from "./strategy.types.ts";
import type { ExecutionSeries } from "../market/backtest.types.ts";
export function computeBacktest(input: BacktestInput): BacktestReport {
  if (input.algorithm_version !== BACKTEST_VERSION)
    throw Error("BACKTEST_ALGORITHM_VERSION_UNAVAILABLE");
  const bars = input.snapshot.dataset.bars.filter(
      (b) => b.date <= input.end_at,
    ),
    dates = new Set(bars.map((b) => b.date));
  const sessions = Object.entries(input.calendar.sessions)
    .filter(([date, open]) => open && date <= input.end_at)
    .map(([date]) => date);
  const missing: string[] = [];
  if (input.calendar.status !== "available")
    missing.push("CALENDAR_" + input.calendar.status.toUpperCase());
  if (
    sessions.some((d) => !dates.has(d)) ||
    bars.some((b) => input.calendar.sessions[b.date] !== true)
  )
    missing.push("CALENDAR_OR_PRICE_GAPS");
  if (!bars.some((b) => b.date >= input.start_at))
    missing.push("NO_TRADING_SESSIONS_IN_RANGE");
  if (!input.execution_review)
    missing.push("EXECUTION_AND_CORPORATE_ACTION_FACTS_NOT_REVIEWED");
  const series = {
    price_basis: input.snapshot.dataset.price_basis,
    interval: "day",
    sessions,
    bars: bars.map((b) => {
      const fact = input.execution_review?.facts.find((f) => f.date === b.date);
      return {
        time: b.date + "T15:00:00+08:00",
        open_at: b.date + "T09:30:00+08:00",
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume_shares: b.volume_shares,
        ...(fact
          ? {
              available_at: fact.available_at,
              suspended: fact.suspended,
              limit_up: fact.limit_up,
              limit_down: fact.limit_down,
              adj_factor: fact.adj_factor,
              split_ratio: fact.split_ratio,
              cash_dividend: fact.cash_dividend,
              corporate_actions_known: true,
            }
          : { corporate_actions_known: false }),
      };
    }),
  } as ExecutionSeries;
  const cases = input.cases.map((c) => {
    const result = missing.length
      ? ({
          status: "incomplete",
          missing: [...missing],
          metrics: null,
          trades: [],
          orders: [],
          equity: [],
          input_digest: digest({
            series,
            config: c.config,
            start_at: input.start_at,
            end_at: input.end_at,
          }),
          algorithm_version: BACKTEST_VERSION,
          config: c.config,
        } as CaseResult)
      : runBacktest(series, c.config, input.start_at, input.end_at);
    return { ...c, result };
  });
  const context_digest = digest({
    instrument: input.instrument,
    account_id: input.account_id,
    snapshot: input.snapshot,
    calendar: input.calendar,
    start_at: input.start_at,
    end_at: input.end_at,
    decision_at: input.decision_at,
    execution_review: input.execution_review,
    algorithm_version: input.algorithm_version,
  });
  const report = {
    algorithm_version: BACKTEST_VERSION,
    input_digest: input.digest,
    context_digest,
    status: cases.every((c) => c.result.status === "complete")
      ? ("complete" as const)
      : ("incomplete" as const),
    limitations: [
      "仅为受控日线多头、次日开盘执行与T+1模型，不代表真实下单或未来收益。",
      "交易状态、历史可获知时点、公司行动与复权因子为本人来源声明，未独立验证；缺失时不自动补正常。",
      "同数据比较/网格是样本内探索；没有样本外检验，不自动采用最高收益参数。",
    ],
    cases,
  };
  if (Buffer.byteLength(JSON.stringify(report)) > 6 * 1024 * 1024)
    throw Error("BACKTEST_REPORT_CAPACITY_EXCEEDED");
  return { ...report, output_digest: digest(report) };
}

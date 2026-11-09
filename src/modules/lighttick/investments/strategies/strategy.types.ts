import type { LightTickOwner } from "../../lighttick.types.ts";
import type { InvestmentInstrument } from "../investment.types.ts";
import type { MarketSnapshot } from "../market/market-work.types.ts";
import type { BacktestConfig } from "../market/backtest.types.ts";
import type { MarketCalendar } from "../market/market.calendar.ts";
import type { runBacktest } from "../market/backtest.engine.ts";
export interface StrategyFields {
  name: string;
  description: string;
  config: BacktestConfig;
}
export interface StrategyDefinition {
  id: string;
  revision: number;
  archive_epoch: number;
  fields: StrategyFields;
  definition_digest: string;
  request_key: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface StrategyRef {
  id: string;
  version: number;
  definition_digest: string;
}
export type RunMode = "single" | "compare" | "grid";
export interface GridAxis {
  parameter: "fast_window" | "slow_window" | "entry_above" | "exit_below";
  values: (string | number)[];
}
export interface StrategyCase {
  index: number;
  strategy: StrategyRef;
  config: BacktestConfig;
}
export interface ExecutionFact {
  date: string;
  available_at: string;
  suspended: boolean;
  limit_up: string;
  limit_down: string;
  adj_factor: string;
  split_ratio: string;
  cash_dividend: string;
}
export interface ExecutionReview {
  source_note: string;
  reviewed_at: string;
  facts: ExecutionFact[];
}
export interface BacktestInput {
  strategy_heads: { id: string; archive_epoch: number }[];
  mode: RunMode;
  strategies: StrategyDefinition[];
  cases: StrategyCase[];
  axes: GridAxis[];
  instrument: InvestmentInstrument;
  account_id: string | null;
  snapshot: MarketSnapshot;
  calendar: MarketCalendar;
  start_at: string;
  end_at: string;
  decision_at: string;
  execution_review: ExecutionReview | null;
  algorithm_version: string;
  digest: string;
}
export type CaseResult = ReturnType<typeof runBacktest>;
export interface BacktestReport {
  algorithm_version: string;
  input_digest: string;
  output_digest: string;
  context_digest: string;
  status: "complete" | "incomplete";
  limitations: string[];
  cases: (StrategyCase & { result: CaseResult })[];
}
export interface BacktestWork extends LightTickOwner {
  id: string;
  sequence: number;
  revision: number;
  request_key: string;
  command_keys: string[];
  input: BacktestInput;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  output: BacktestReport | null;
  created_at: string;
  updated_at: string;
}
export const workSummary = (w: BacktestWork) => ({
  id: w.id,
  sequence: w.sequence,
  revision: w.revision,
  status: w.status,
  attempt: w.attempt,
  error_code: w.error_code,
  created_at: w.created_at,
  updated_at: w.updated_at,
  mode: w.input.mode,
  strategy_ids: w.input.strategies.map((s) => s.id),
});
export type WorkSummary = ReturnType<typeof workSummary>;
export interface StrategyRepository {
  definition(
    o: LightTickOwner,
    id: string,
    version?: number,
  ): Promise<StrategyDefinition | undefined>;
  definitions(o: LightTickOwner): Promise<StrategyDefinition[]>;
  versions(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<StrategyDefinition[]>;
  saveDefinition(
    o: LightTickOwner,
    d: StrategyDefinition,
    base: number,
  ): Promise<void>;
  work(o: LightTickOwner, id: string): Promise<BacktestWork | undefined>;
  works(o: LightTickOwner): Promise<WorkSummary[]>;
  saveWork(w: BacktestWork, base: number): Promise<void>;
  recoverable(now: string): Promise<BacktestWork[]>;
}
export function publicWork({
  appId,
  userId,
  fence,
  lease_until,
  command_keys,
  ...w
}: BacktestWork) {
  const { snapshot, execution_review, ...input } = w.input;
  return {
    ...w,
    input: {
      ...input,
      snapshot: {
        ...snapshot,
        dataset: {
          ...snapshot.dataset,
          bars: undefined,
          bar_count: snapshot.dataset.bars.length,
        },
      },
      execution_review: execution_review
        ? {
            source_note: execution_review.source_note,
            reviewed_at: execution_review.reviewed_at,
            fact_count: execution_review.facts.length,
          }
        : null,
    },
    output: w.output
      ? {
          ...w.output,
          cases: w.output.cases.map((c) => {
            const { trades, orders, equity, ...result } = c.result;
            return {
              ...c,
              result: {
                ...result,
                trade_count: trades.length,
                order_count: orders.length,
                equity_count: equity.length,
              },
            };
          }),
        }
      : null,
  };
}

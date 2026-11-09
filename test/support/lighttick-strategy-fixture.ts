import { observationFixture } from "./lighttick-observation-fixture.ts";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import { StrategyService } from "../../src/modules/lighttick/investments/strategies/strategy.service.ts";
import { StrategyRunner } from "../../src/modules/lighttick/investments/strategies/strategy.runner.ts";
import { backtestConfig } from "../../src/modules/lighttick/investments/market/backtest.validation.ts";
export async function strategyFixture(
  repo?: LightTickRepository,
  userId = "strategy-synthetic",
) {
  const f = await observationFixture(repo, userId),
    s = new StrategyService(f.repo, f.queue, async () => {}, f.s.clock),
    runner = new StrategyRunner(s);
  const fields = {
    name: "Synthetic threshold",
    description: "  Original hypothesis\nKeep baseline  ",
    config: backtestConfig({
      strategy: "threshold",
      entry_above: "10",
      exit_below: "9",
      slippage_bps: "0",
      max_participation: "1",
      minimum_commission: "0",
      commission_rate: "0",
      sell_tax_rate: "0",
    }),
  };
  const d = await s.writeDefinition(
    f.o,
    "inv-strategy-threshold",
    { base_revision: 0, fields },
    "strategy-original",
  );
  const body = {
    mode: "single",
    strategies: [
      { id: d.id, version: d.revision, definition_digest: d.definition_digest },
    ],
    axes: [],
    instrument_id: f.instrument.id,
    account_id: null,
    snapshot_id: f.daily.id,
    input_digest: f.daily.dataset.input_digest,
    start_at: "2026-11-03",
    end_at: "2026-11-06",
    decision_at: f.s.clock().toISOString(),
    execution_review: {
      source_note: "Synthetic declared facts only",
      reviewed_at: f.s.clock().toISOString(),
      facts: f.daily.dataset.bars.map((b) => ({
        date: b.date,
        available_at: b.date + "T07:05:00Z",
        suspended: false,
        limit_up: "20",
        limit_down: "5",
        adj_factor: "1",
        split_ratio: "1",
        cash_dividend: "0",
      })),
    },
    consent: true,
  };
  return { ...f, s, runner, d, fields, body };
}

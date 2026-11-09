import { MarketWorkService } from "../../src/modules/lighttick/investments/market/market-work.service.ts";
import { MarketWorkRunner } from "../../src/modules/lighttick/investments/market/market-work.runner.ts";
import { DailyMarketAdapter } from "../../src/modules/lighttick/investments/market/market.adapter.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ObservationWorkService } from "../../src/modules/lighttick/investments/observations/observation.work-service.ts";
import { ObservationRunner } from "../../src/modules/lighttick/investments/observations/observation.runner.ts";
import { referenceCalendar } from "../../src/modules/lighttick/investments/market/market.calendar.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
export async function observationFixture(
  repo: LightTickRepository = new InMemoryLightTickRepository(),
  userId = "observation-synthetic",
) {
  const o = { appId: "lighttick" as const, userId };
  let now = new Date("2026-11-02T08:00:00Z");
  const queue = new InMemoryJobQueue(),
    s = new ObservationWorkService(
      repo,
      queue,
      async () => {},
      () => now,
    ),
    runner = new ObservationRunner(s);
  const instrument = (
    await s.createInstrument(
      o,
      {
        market: "SSE",
        code: "600000",
        kind: "stock",
        name: "Synthetic observation",
      },
      "instrument-original",
    )
  ).instrument;
  function snapshot(
    id: string,
    dates: string[],
    closes: string[],
    available: string,
  ) {
    const bars = dates.map((date, i) => ({
      date,
      open: closes[i],
      high: closes[i],
      low: closes[i],
      close: closes[i],
      volume_shares: "100",
      amount_cny: "1000",
      turnover_rate_pct: "2",
    }));
    return {
      id,
      revision: 1 as const,
      instrument_id: instrument.id,
      instrument_revision: 1,
      work_id: id + "-work",
      created_at: available,
      indicators: {} as any,
      dataset: {
        supplier: "csv" as const,
        adapter_version: "synthetic-v1",
        instrument_id: instrument.id,
        code: instrument.code,
        market: "SSE",
        kind: "stock",
        start: dates[0],
        end: dates.at(-1)!,
        price_basis: "unadjusted" as const,
        realtime: false as const,
        retrieved_at: available,
        available_at: available,
        source_units: { volume: "shares", amount: "CNY" },
        calendar: referenceCalendar(
          "SSE",
          "2026-10-01",
          dates.at(-1)!,
          new Date(available),
        ) as any,
        missing_sessions: [],
        bars,
        input_digest: digest(bars),
        limitations: ["Synthetic only"],
      },
    };
  }
  async function publishSource(m: ReturnType<typeof snapshot>) {
    const clock = () => new Date(m.dataset.available_at),
      market = new MarketWorkService(repo, queue, async () => {}, clock),
      adapter = new DailyMarketAdapter(
        async () => ({ enabled: true, revision: "synthetic-v1" }),
        undefined,
        clock,
      );
    const csv =
      "date,open,high,low,close,volume,amount,turnover_rate_pct\n" +
      m.dataset.bars
        .map((b) =>
          [
            b.date,
            b.open,
            b.high,
            b.low,
            b.close,
            b.volume_shares,
            b.amount_cny,
            b.turnover_rate_pct ?? "",
          ].join(","),
        )
        .join("\n");
    const w = await market.create(
      o,
      {
        instrument_id: instrument.id,
        base_revision: instrument.revision,
        supplier: "csv",
        start: m.dataset.start,
        end: m.dataset.end,
        csv,
        declared_source: "Synthetic observation dataset",
        volume_unit: "shares",
        amount_unit: "CNY",
      },
      "market-" + m.id,
    );
    await new MarketWorkRunner(market, adapter).execute(o, w.id);
    const done = await market.readWork(o, w.id);
    if (done.status !== "succeeded")
      throw Error("Synthetic market failed: " + done.error_code);
    return (await repo.investments.market.snapshot(o, done.snapshot_id!))!;
  }
  const baseline = await publishSource(
    snapshot(
      "inv-observe-baseline",
      ["2026-11-02"],
      ["10"],
      "2026-11-02T07:30:00Z",
    ),
  );

  const predictionFields = {
    instrument_id: instrument.id,
    account_id: null,
    direction: "up",
    probability: 80,
    reason: "Synthetic hypothesis",
    counterevidence: "Synthetic contrary evidence",
    baseline: {
      snapshot_id: baseline.id,
      input_digest: baseline.dataset.input_digest,
      date: "2026-11-02",
    },
    references: [],
  };
  const pid = "inv-observe-prediction";
  await s.write(
    o,
    "predictions",
    pid,
    { base_revision: 0, fields: predictionFields, consent: true },
    "prediction-original",
  );
  now = new Date("2026-11-06T08:00:00Z");
  const daily = await publishSource(
    snapshot(
      "inv-observe-daily",
      ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"],
      ["11", "12", "13", "14"],
      now.toISOString(),
    ),
  );

  const evaluationBody = {
    base_revision: 1,
    as_of: "2026-11-06",
    decision_at: now.toISOString(),
    sources: [{ id: daily.id, input_digest: daily.dataset.input_digest }],
    corporate_action_review: null,
    consent: true,
  };
  const monitorFields = {
    instrument_id: instrument.id,
    account_id: null,
    name: "Synthetic daily monitor",
    field: "close",
    op: "gt",
    threshold: "12",
    supplier: "csv",
    enabled: true,
    interval_seconds: 300,
    cooldown_seconds: 86400,
  };
  return {
    o,
    repo,
    s,
    runner,
    queue,
    pid,
    baseline,
    daily,
    instrument,
    predictionFields,
    monitorFields,
    evaluationBody,
    snapshot,
    publishSource,
    setTime: (value: string) => {
      now = new Date(value);
    },
  };
}

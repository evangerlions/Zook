import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { MarketWorkService } from "../../src/modules/lighttick/investments/market/market-work.service.ts";
import { MarketWorkRunner } from "../../src/modules/lighttick/investments/market/market-work.runner.ts";
import { DailyMarketAdapter } from "../../src/modules/lighttick/investments/market/market.adapter.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
test("PG market precision, atomic terminal snapshot, reconnect, lease recovery and owner deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "market-pg-" + process.pid },
    queue = new InMemoryJobQueue();
  let now = new Date("2026-11-05T08:00:00Z");
  const service = new MarketWorkService(
      repo,
      queue,
      async () => {},
      () => now,
    ),
    adapter = new DailyMarketAdapter(
      async () => ({ enabled: true, revision: "synthetic" }),
      undefined,
      () => now,
    ),
    runner = new MarketWorkRunner(service, adapter);
  try {
    const i = (
      await new InvestmentService(repo).createInstrument(
        o,
        { market: "SSE", code: "600000", kind: "stock", name: "Synthetic" },
        "market-pg-symbol",
      )
    ).instrument;
    const body = {
      instrument_id: i.id,
      base_revision: 1,
      supplier: "csv",
      start: "2026-10-30",
      end: "2026-10-30",
      csv: "date,open,high,low,close,volume,amount\n2026-10-30,10,12,9,11,0.0000000001,9007199254740993.0000000001\n",
      declared_source: "Synthetic",
      volume_unit: "shares",
      amount_unit: "CNY",
    };
    const w = await service.create(o, body, "market-pg-original"),
      store = repo.investments.market,
      save = store.save.bind(store);
    store.save = async (r, b) => {
      if (r.status === "succeeded") throw Error("synthetic terminal crash");
      return save(r, b);
    };
    await assert.rejects(runner.execute(o, w.id));
    store.save = save;
    assert.equal(await other.investments.market.snapshot(o, w.id), undefined);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_market_bars WHERE user_id=$1",
          [o.userId],
        )
      ).rows[0].n,
      0,
    );
    now = new Date(now.getTime() + 120001);
    await new MarketWorkRunner(
      new MarketWorkService(
        other,
        queue,
        async () => {},
        () => now,
      ),
      adapter,
    ).execute(o, w.id);
    const done = await service.create(o, body, "market-pg-original");
    assert.equal(done.status, "succeeded");
    const snapshot = await service.readSnapshot(o, w.id);
    assert.deepEqual(
      await other.investments.market.snapshot(o, w.id),
      snapshot,
    );
    assert.equal(
      snapshot.dataset.bars[0].amount_cny,
      "9007199254740993.0000000001",
    );
    assert.equal(snapshot.dataset.bars[0].volume_shares, "0.0000000001");
    const raw = (
      await pool.query(
        "SELECT pg_typeof(amount_cny)::text AS kind,amount_cny::text AS amount FROM zook_lighttick_market_bars WHERE user_id=$1",
        [o.userId],
      )
    ).rows[0];
    assert.equal(raw.kind, "numeric");
    assert.equal(raw.amount, "9007199254740993.0000000001");
    assert.deepEqual(await other.investments.accounts(o), []);
    await repo.deleteOwnerData(o);
    assert.equal(await other.investments.market.snapshot(o, w.id), undefined);
    assert.equal(await other.investments.market.get(o, w.id), undefined);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

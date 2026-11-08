import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { MarketWorkService } from "../../src/modules/lighttick/investments/market/market-work.service.ts";
import { MarketWorkRunner } from "../../src/modules/lighttick/investments/market/market-work.runner.ts";
import { DailyMarketAdapter } from "../../src/modules/lighttick/investments/market/market.adapter.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-market" };
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  let now = new Date("2026-11-05T08:00:00Z");
  const s = new InvestmentService(repo),
    service = new MarketWorkService(
      repo,
      queue,
      async () => {},
      () => now,
    ),
    i = (
      await s.createInstrument(
        o,
        {
          code: "600000",
          kind: "stock",
          market: "SSE",
          name: "Synthetic source",
        },
        "market-original-symbol",
      )
    ).instrument;
  const adapter = new DailyMarketAdapter(
      async () => ({ enabled: true, revision: "synthetic-v1" }),
      undefined,
      () => now,
    ),
    runner = new MarketWorkRunner(service, adapter),
    body = {
      instrument_id: i.id,
      base_revision: 1,
      supplier: "csv",
      start: "2026-10-30",
      end: "2026-10-30",
      declared_source: "Synthetic CSV",
      volume_unit: "shares",
      amount_unit: "CNY",
      csv: "date,open,high,low,close,volume,amount\n2026-10-30,10,12,9,11,100,9007199254740993.0000000001",
    };
  return {
    repo,
    queue,
    s,
    service,
    adapter,
    runner,
    body,
    i,
    tick: () => {
      now = new Date(now.getTime() + 120001);
    },
  };
}
test("daily work is independent of accounts, exact, immutable, owner scoped and replayed to the same terminal receipt", async () => {
  const f = await setup(),
    w = await f.service.create(o, f.body, "market-original-request");
  assert.equal(w.status, "queued");
  assert.equal(await f.repo.investments.market.snapshot(o, w.id), undefined);
  await f.runner.execute(o, w.id);
  await f.runner.execute(o, w.id);
  const terminal = await f.service.create(o, f.body, "market-original-request");
  assert.equal(terminal.status, "succeeded");
  const data = await f.service.readSnapshot(o, terminal.snapshot_id!);
  assert.equal(data.dataset.bars[0].amount_cny, "9007199254740993.0000000001");
  assert.equal(data.indicators.ma5, null);
  assert.deepEqual(await f.repo.investments.accounts(o), []);
  assert.equal(Object.hasOwn(terminal.input, "csv"), false);
  await assert.rejects(
    f.service.create(
      o,
      { ...f.body, csv: f.body.csv + "\n" },
      "market-original-request",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    f.service.readSnapshot({ ...o, userId: "foreign" }, w.id),
    { statusCode: 404 },
  );
  await f.repo.deleteOwnerData(o);
  assert.equal(await f.repo.investments.market.snapshot(o, w.id), undefined);
});
test("queue failure remains recoverable and a terminal crash rolls back all published data", async () => {
  const f = await setup();
  f.queue.markNextAddAsFailure();
  const w = await f.service.create(o, f.body, "market-crash-request");
  assert.equal(f.queue.jobs.length, 0);
  assert.equal(await f.runner.recover(), 1);
  const store = f.repo.investments.market,
    save = store.save.bind(store);
  store.save = async (r, b) => {
    if (r.status === "succeeded") throw Error("synthetic crash");
    return save(r, b);
  };
  await assert.rejects(f.runner.execute(o, w.id));
  store.save = save;
  assert.equal(await store.snapshot(o, w.id), undefined);
  f.tick();
  await f.runner.execute(o, w.id);
  assert.equal((await f.service.readWork(o, w.id)).status, "succeeded");
  assert.equal((await store.summaries(o)).length, 1);
});
test("cancelling a live computation fences late publish without deleting local requests", async () => {
  const f = await setup(),
    w = await f.service.create(o, f.body, "market-cancel-request"),
    read = f.adapter.read.bind(f.adapter);
  f.adapter.read = async (...args) => {
    const result = await read(...args);
    const current = await f.service.readWork(o, w.id);
    await f.service.cancel(
      o,
      w.id,
      { base_revision: current.revision },
      "market-explicit-cancel",
    );
    return result;
  };
  await f.runner.execute(o, w.id);
  assert.equal(
    (await f.service.create(o, f.body, "market-cancel-request")).status,
    "cancelled",
  );
  assert.equal(await f.repo.investments.market.snapshot(o, w.id), undefined);
});
test("IO holds no owner lock; a concurrent instrument change makes the old work fail atomically", async () => {
  const f = await setup(),
    w = await f.service.create(o, f.body, "market-context-request"),
    read = f.adapter.read.bind(f.adapter);
  f.adapter.read = async (...args) => {
    const result = await read(...args);
    await f.s.updateInstrument(
      o,
      f.i.id,
      { base_revision: 1, name: "Changed name", archived: false },
      "market-concurrent-name",
    );
    return result;
  };
  await f.runner.execute(o, w.id);
  assert.equal(
    (await f.service.readWork(o, w.id)).error_code,
    "INSTRUMENT_CONTEXT_CHANGED",
  );
  assert.equal(await f.repo.investments.market.snapshot(o, w.id), undefined);
});
test("disabled provider and malformed CSV reach explicit terminal failures with no fallback or partial dataset", async () => {
  const f = await setup();
  f.adapter.policy = async () => ({ enabled: false, revision: "off" });
  const w = await f.service.create(o, f.body, "market-disabled-request");
  await f.runner.execute(o, w.id);
  assert.equal(
    (await f.service.readWork(o, w.id)).error_code,
    "SUPPLIER_DISABLED",
  );
  assert.equal(await f.repo.investments.market.snapshot(o, w.id), undefined);
});
test("CSV source parsing belongs to worker and snapshot cursor expires without altering accepted receipts", async () => {
  const f = await setup();
  for (let n = 0; n < 3; n++) {
    const w = await f.service.create(o, f.body, "market-page-" + n);
    await f.runner.execute(o, w.id);
  }
  const page = await f.service.listSnapshots(o, undefined, "", 1);
  assert.ok(page.next_cursor);
  assert.equal(
    (await f.service.listSnapshots(o, undefined, page.next_cursor!, 1)).items
      .length,
    1,
  );
  const w = await f.service.create(o, f.body, "market-page-new");
  await f.runner.execute(o, w.id);
  await assert.rejects(
    f.service.listSnapshots(o, undefined, page.next_cursor!, 1),
    { statusCode: 409 },
  );
  const bad = await f.service.create(
    o,
    { ...f.body, csv: "bad data" },
    "market-invalid-csv",
  );
  await f.runner.execute(o, bad.id);
  assert.equal((await f.service.readWork(o, bad.id)).status, "failed");
  assert.equal(await f.repo.investments.market.snapshot(o, bad.id), undefined);
});

test("a provider ignoring cancellation cannot hold work past the bounded timeout", async () => {
  const f = await setup(),
    w = await f.service.create(o, f.body, "market-timeout-request");
  const runner = new MarketWorkRunner(
    f.service,
    { read: async () => new Promise(() => {}) } as any,
    async () => {},
    5,
  );
  await runner.execute(o, w.id);
  assert.equal((await f.service.readWork(o, w.id)).error_code, "TIMEOUT");
  assert.equal(await f.repo.investments.market.snapshot(o, w.id), undefined);
});

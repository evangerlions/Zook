import { exportReview } from "../../src/modules/lighttick/knowledge/review.export.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { InvestmentLedgerService } from "../../src/modules/lighttick/investments/ledger.service.ts";
import {
  InvestmentLedgerRunner,
  calculateLedger,
} from "../../src/modules/lighttick/investments/ledger.runner.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-ledger" },
  account = "inv-ledger-fixture";
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  let now = new Date("2026-11-04T08:00:00Z");
  const s = new InvestmentService(repo),
    l = new InvestmentLedgerService(
      repo,
      queue,
      async () => {},
      () => now,
    ),
    runner = new InvestmentLedgerRunner(l);
  const i = (
    await s.createInstrument(
      o,
      { market: "SSE", kind: "stock", code: "600001.SH", name: "Synthetic" },
      "ledger-instrument",
    )
  ).instrument;
  await s.createAccount(
    o,
    account,
    {
      base_revision: 0,
      name: "Synthetic",
      currency: "CNY",
      baseline_date: "2026-01-01",
      opening_cash: "100",
      opening_positions: [],
    },
    "ledger-account",
  );
  const buy = {
    base_revision: 1,
    business_date: "2026-11-04",
    kind: "fill",
    fill: {
      instrument_id: i.id,
      side: "buy",
      price: "0.1",
      quantity: "3",
      fee: null,
      tax: "0",
      source: "manual",
      settlement_amount: null,
    },
  };
  return {
    repo,
    queue,
    s,
    l,
    runner,
    i,
    buy,
    tick: () => {
      now = new Date(now.getTime() + 120001);
    },
  };
}
test("ledger worker confirms exact immutable facts and terminal replay without inventing fees or marks", async () => {
  const { repo, l, runner, buy } = await setup();
  const w = await l.append(o, account, buy, "ledger-buy-original");
  assert.equal(w.status, "queued");
  assert.equal((await repo.investments.ledger.events(o, account)).length, 0);
  await runner.execute(o, w.id);
  await runner.execute(o, w.id);
  const terminal = await l.append(o, account, buy, "ledger-buy-original");
  assert.equal(terminal.status, "succeeded");
  assert.equal(terminal.output!.result.cash, "99.7");
  assert.equal(terminal.output!.result.cash_verified, false);
  assert.equal(terminal.output!.result.equity, null);
  assert.equal(terminal.output!.result.positions[0].mark, null);
  assert.equal((await repo.investments.account(o, account))!.revision, 2);
  assert.equal((await repo.investments.ledger.events(o, account)).length, 1);
  await assert.rejects(
    l.append(o, account, { ...buy, base_revision: 2 }, "ledger-buy-original"),
    { statusCode: 409 },
  );
  await assert.rejects(l.work({ ...o, userId: "foreign" }, w.id), {
    statusCode: 404,
  });
});
test("unknown fields, floats, future dates and foreign instruments never enqueue", async () => {
  const { l, buy } = await setup();
  for (const b of [
    { ...buy, business_date: "2026-11-05" },
    { ...buy, fill: { ...buy.fill, price: 0.1 } },
    { ...buy, fill: { ...buy.fill, fee: undefined } },
    { ...buy, cash: { kind: "deposit", amount: "1" } },
    { ...buy, fill: { ...buy.fill, settlement_amount: "1" } },
  ])
    await assert.rejects(l.append(o, account, b, "ledger-invalid-command"), {
      statusCode: 422,
    });
  await assert.rejects(
    l.append(
      o,
      account,
      { ...buy, fill: { ...buy.fill, instrument_id: "inv-foreign-fixture" } },
      "ledger-foreign-command",
    ),
    { statusCode: 404 },
  );
});
test("oversell reaches a durable failure and adds no financial fact", async () => {
  const { repo, l, runner, buy } = await setup();
  const w = await l.append(
    o,
    account,
    { ...buy, fill: { ...buy.fill, side: "sell" } },
    "ledger-oversell-original",
  );
  await runner.execute(o, w.id);
  const result = await l.work(o, w.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "LEDGER_INPUT_INVALID");
  assert.equal((await repo.investments.account(o, account))!.revision, 1);
  assert.deepEqual(await repo.investments.ledger.events(o, account), []);
});
test("cancellation fences a live calculation and original replay remains cancelled", async () => {
  const { repo, l, buy } = await setup();
  const w = await l.append(o, account, buy, "ledger-cancelled-original");
  const runner = new InvestmentLedgerRunner(
    l,
    async () => {},
    async (a, e) => {
      const current = await l.work(o, w.id);
      await l.cancel(
        o,
        w.id,
        { base_revision: current.revision },
        "ledger-explicit-cancel",
      );
      return calculateLedger(a, e);
    },
  );
  await runner.execute(o, w.id);
  assert.equal(
    (await l.append(o, account, buy, "ledger-cancelled-original")).status,
    "cancelled",
  );
  assert.deepEqual(await repo.investments.ledger.events(o, account), []);
});
test("calculation holds no owner lock and a newer account commit rejects the stale result", async () => {
  const { repo, l, s, buy } = await setup();
  const w = await l.append(o, account, buy, "ledger-stale-original");
  const runner = new InvestmentLedgerRunner(
    l,
    async () => {},
    async (a, e) => {
      await s.archiveAccount(
        o,
        account,
        { base_revision: 1, archived: true },
        "ledger-archive-during-compute",
      );
      return calculateLedger(a, e);
    },
  );
  await runner.execute(o, w.id);
  assert.equal((await l.work(o, w.id)).error_code, "ACCOUNT_CONTEXT_CHANGED");
  assert.deepEqual(await repo.investments.ledger.events(o, account), []);
});
test("revocation during calculation blocks all fact writes and preserves a failed receipt", async () => {
  const { repo, l, buy } = await setup();
  let allowed = true;
  const w = await l.append(o, account, buy, "ledger-revoked-original");
  const runner = new InvestmentLedgerRunner(
    l,
    async () => {
      if (!allowed) throw Error("revoked");
    },
    async (a, e) => {
      allowed = false;
      return calculateLedger(a, e);
    },
  );
  await runner.execute(o, w.id);
  assert.equal((await l.work(o, w.id)).status, "failed");
  assert.deepEqual(await repo.investments.ledger.events(o, account), []);
});
test("crash after append rolls back account and event; expired lease recovers one terminal result", async () => {
  const { repo, l, runner, buy, tick, queue } = await setup();
  queue.markNextAddAsFailure();
  const w = await l.append(o, account, buy, "ledger-crash-original");
  assert.equal(queue.jobs.length, 0);
  const store = repo.investments.ledger,
    save = store.save.bind(store);
  store.save = async (r, b) => {
    if (r.status === "succeeded") throw Error("synthetic terminal crash");
    return save(r, b);
  };
  await assert.rejects(runner.execute(o, w.id));
  store.save = save;
  assert.equal((await repo.investments.account(o, account))!.revision, 1);
  assert.deepEqual(await store.events(o, account), []);
  tick();
  assert.equal(await runner.recover(), 1);
  await runner.execute(o, w.id);
  assert.equal((await l.work(o, w.id)).status, "succeeded");
  assert.equal((await store.events(o, account)).length, 1);
});
test("paged ledger rebuild expires on account changes and cash events preserve exact strings", async () => {
  const { l, runner } = await setup();
  for (let n = 1; n <= 2; n++) {
    const w = await l.append(
      o,
      account,
      {
        base_revision: n,
        business_date: "2026-11-04",
        kind: "cash",
        cash: { kind: "deposit", amount: "0.0000000001" },
      },
      "ledger-cash-original-" + n,
    );
    await runner.execute(o, w.id);
  }
  const page = await l.ledger(o, account, "", 1);
  assert.ok(page.next_cursor);
  assert.equal(page.report!.result.cash, "100.0000000002");
  const replay = await l.ledger(o, account, page.next_cursor!, 1);
  assert.equal(replay.items.length, 1);
  assert.deepEqual(await l.ledger(o, account, page.next_cursor!, 1), replay);
  const w = await l.append(
    o,
    account,
    {
      base_revision: 3,
      business_date: "2026-11-04",
      kind: "cash",
      cash: { kind: "withdrawal", amount: "0.1" },
    },
    "ledger-cash-original-3",
  );
  await runner.execute(o, w.id);
  await assert.rejects(l.ledger(o, account, page.next_cursor!, 1), {
    statusCode: 409,
  });
});

test("authorized export includes owned ledger original body and terminal receipt without lease or queue internals", async () => {
  const { repo, l, runner, buy } = await setup();
  const w = await l.append(o, account, buy, "ledger-export-original");
  await runner.execute(o, w.id);
  const exported = await exportReview(repo, o, async () => {}),
    body = JSON.parse(exported.content),
    own = body.investments;
  assert.equal(body.revision, exported.revision);
  assert.equal(own.accounts.length, 1);
  assert.equal(own.ledgers[0].events.length, 1);
  assert.equal(
    own.ledgers[0].receipts[0].request_key,
    "ledger-export-original",
  );
  assert.deepEqual(own.ledgers[0].receipts[0].request_body, buy);
  assert.equal(own.ledgers[0].receipts[0].status, "succeeded");
  for (const key of ["fence", "lease_until", "request_key"])
    assert.equal(Object.hasOwn(own.ledgers[0].events[0], key), false);
  assert.equal(Object.hasOwn(own.ledgers[0].receipts[0], "fence"), false);
  assert.equal(Object.hasOwn(own.ledgers[0].receipts[0], "lease_until"), false);
  const foreign = JSON.parse(
    (await exportReview(repo, { ...o, userId: "foreign" }, async () => {}))
      .content,
  );
  assert.deepEqual(foreign.investments, {
    instruments: [],
    accounts: [],
    ledgers: [],
    market:{snapshots:[],receipts:[]},
  });
});

test("expired lease permits a second worker and fences the first late result", async () => {
  const { repo, l, buy, runner, tick } = await setup(),
    w = await l.append(o, account, buy, "ledger-fenced-original");
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>((r) => (start = r)),
    release = new Promise<void>((r) => (finish = r));
  const slow = new InvestmentLedgerRunner(
    l,
    async () => {},
    async (a, e) => {
      start();
      await release;
      return calculateLedger(a, e);
    },
  );
  const first = slow.execute(o, w.id);
  await started;
  tick();
  await runner.execute(o, w.id);
  finish();
  await first;
  const done = await l.work(o, w.id);
  assert.equal(done.status, "succeeded");
  assert.equal((await repo.investments.ledger.get(o, w.id))!.attempt, 2);
  assert.equal((await repo.investments.ledger.events(o, account)).length, 1);
});

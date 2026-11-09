import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { InvestmentLedgerService } from "../../src/modules/lighttick/investments/ledger.service.ts";
import {
  InvestmentLedgerRunner,
  calculateLedger,
} from "../../src/modules/lighttick/investments/ledger.runner.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable synthetic localhost database required");
test("PG ledger NUMERIC facts and durable receipts survive terminal crash/reconnect; computation permits a later owner commit", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "ledger-pg-" + process.pid },
    id = "inv-ledger-pg-fixture";
  let now = new Date("2026-11-04T09:00:00Z");
  const queue = new InMemoryJobQueue(),
    s = new InvestmentService(repo),
    l = new InvestmentLedgerService(
      repo,
      queue,
      async () => {},
      () => now,
    ),
    runner = new InvestmentLedgerRunner(l);
  try {
    await s.createAccount(
      o,
      id,
      {
        base_revision: 0,
        name: "Synthetic",
        currency: "CNY",
        baseline_date: "2026-01-01",
        opening_cash: "0.1",
        opening_positions: [],
      },
      "ledger-pg-account",
    );
    const b = {
        base_revision: 1,
        business_date: "2026-11-04",
        kind: "cash",
        cash: { kind: "deposit", amount: "0.0000000001" },
      },
      w = await l.append(o, id, b, "ledger-pg-deposit");
    const store = repo.investments.ledger,
      save = store.save.bind(store);
    store.save = async (r, b) => {
      if (r.status === "succeeded") throw Error("synthetic terminal crash");
      return save(r, b);
    };
    await assert.rejects(runner.execute(o, w.id));
    store.save = save;
    assert.deepEqual(await other.investments.ledger.events(o, id), []);
    assert.equal((await other.investments.account(o, id))!.revision, 1);
    now = new Date(now.getTime() + 120001);
    await new InvestmentLedgerRunner(
      new InvestmentLedgerService(
        other,
        queue,
        async () => {},
        () => now,
      ),
    ).execute(o, w.id);
    const terminal = await l.append(o, id, b, "ledger-pg-deposit");
    assert.equal(terminal.status, "succeeded");
    assert.equal(terminal.output!.result.cash, "0.1000000001");
    const row = (
      await pool.query(
        "SELECT pg_typeof(amount)::text AS kind,amount::text AS amount FROM zook_lighttick_investment_events WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0];
    assert.equal(row.kind, "numeric");
    assert.equal(row.amount, "0.0000000001");
    const next = await l.append(
      o,
      id,
      { ...b, base_revision: 2 },
      "ledger-pg-stale",
    );
    await new InvestmentLedgerRunner(
      l,
      async () => {},
      async (a, e) => {
        await new InvestmentService(other).archiveAccount(
          o,
          id,
          { base_revision: 2, archived: true },
          "ledger-pg-concurrent-archive",
        );
        return calculateLedger(a, e);
      },
    ).execute(o, next.id);
    assert.equal(
      (await l.work(o, next.id)).error_code,
      "ACCOUNT_CONTEXT_CHANGED",
    );
    assert.equal((await store.events(o, id)).length, 1);
    await repo.deleteOwnerData(o);
    assert.deepEqual(await other.investments.ledger.events(o, id), []);
    assert.equal(await other.investments.ledger.get(o, w.id), undefined);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { strategyFixture } from "../support/lighttick-strategy-fixture.ts";
import { StrategyService } from "../../src/modules/lighttick/investments/strategies/strategy.service.ts";
import { StrategyRunner } from "../../src/modules/lighttick/investments/strategies/strategy.runner.ts";
import { computeBacktest } from "../../src/modules/lighttick/investments/strategies/strategy.engine.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Dedicated synthetic localhost database required");
test("PG strategy originals/versions/CAS, CSV source, rollback, real recovery thread, late cancellation, export and shared deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    owner = {
      appId: "lighttick" as const,
      userId: "strategy-pg-" + process.pid,
    };
  try {
    const f = await strategyFixture(repo, owner.userId),
      { s, o, d, body } = f,
      second = new StrategyService(other, f.queue, async () => {}, s.clock);
    const writes = await Promise.allSettled([
      s.writeDefinition(
        o,
        d.id,
        { base_revision: 1, fields: { ...f.fields, description: "Client A" } },
        "pg-client-one",
      ),
      second.writeDefinition(
        o,
        d.id,
        { base_revision: 1, fields: { ...f.fields, description: "Client B" } },
        "pg-client-two",
      ),
    ]);
    assert.equal(writes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      (await second.readDefinition(o, d.id, 1)).fields.description,
      f.fields.description,
    );
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(s.createRun(o, body, "pg-crash-original"));
    repo.saveOperation = save;
    assert.equal((await second.listRuns(o)).items.length, 0);
    assert.equal(await other.getOperation(o, "pg-crash-original"), undefined);
    const w = await s.createRun(o, body, "pg-recovery-original"),
      raw = (await s.store.work(o, w.id))!;
    await repo.transaction(o, () =>
      s.store.saveWork(
        {
          ...raw,
          revision: 2,
          status: "running",
          attempt: 1,
          fence: "dead-worker",
          lease_until: "2026-11-06T08:00:01Z",
        },
        1,
      ),
    );
    f.setTime("2026-11-06T08:01:00Z");
    const restarted = new StrategyRunner(second);
    assert.equal(await restarted.recover(), 1);
    await restarted.execute(o, w.id);
    const done = await second.readRun(o, w.id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.attempt, 2);
    assert.equal(done.output!.cases[0].result.metrics!.net_profit, "200");
    assert.equal(
      done.output!.output_digest,
      computeBacktest((await second.store.work(o, w.id))!.input).output_digest,
    );
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((r) => (started = r)),
      gate = new Promise<void>((r) => (release = r)),
      late = await s.createRun(o, body, "pg-cancel-original"),
      runner = new StrategyRunner(
        s,
        async () => {},
        async (input) => {
          started();
          await gate;
          return computeBacktest(input);
        },
      ),
      running = runner.execute(o, late.id);
    await ready;
    const live = await second.readRun(o, late.id);
    await second.cancel(
      o,
      late.id,
      { base_revision: live.revision },
      "pg-cancel-command",
    );
    release();
    await running;
    assert.equal((await second.readRun(o, late.id)).status, "cancelled");
    assert.equal((await second.readRun(o, late.id)).output, null);
    const grid = await second.createRun(
      o,
      {
        ...body,
        mode: "grid",
        axes: [{ parameter: "entry_above", values: ["10", "11"] }],
      },
      "pg-grid-original",
    );
    await restarted.execute(o, grid.id);
    assert.equal((await second.readRun(o, grid.id)).output!.cases.length, 2);
    const first = await second.casePage(o, w.id, 0, "equity", "", 2);
    assert.equal(
      (await second.casePage(o, w.id, 0, "equity", first.next_cursor!, 2)).items
        .length,
      2,
    );
    await assert.rejects(
      second.casePage({ ...o, userId: "foreign" }, w.id, 0, "equity"),
    );
    const exported = await repo.transaction(o, () =>
      exportInvestments(repo, o),
    );
    assert.equal(exported.strategies!.versions.length, 2);
    assert.equal(exported.strategies!.runs.length, 3);
    assert.equal(
      exported.strategies!.runs.find((x) => x.id === late.id)!.commands.length,
      2,
    );
    assert.equal(
      exported.strategies!.runs[0].input.snapshot.dataset.bars.length,
      4,
    );
    assert.equal(
      JSON.stringify(exported.strategies).includes('"fence"'),
      false,
    );
    await other.deleteOwnerData(o);
    for (const table of [
      "strategy_definitions",
      "strategy_versions",
      "backtest_work",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM zook_lighttick_" +
              table +
              " WHERE user_id=$1",
            [o.userId],
          )
        ).rows[0].n,
        0,
      );
  } finally {
    await other.deleteOwnerData(owner);
    await pool.end();
  }
});

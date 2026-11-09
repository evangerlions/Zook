import test from "node:test";
import assert from "node:assert/strict";
import { strategyFixture } from "../support/lighttick-strategy-fixture.ts";
import { StrategyRunner } from "../../src/modules/lighttick/investments/strategies/strategy.runner.ts";
import { computeBacktest } from "../../src/modules/lighttick/investments/strategies/strategy.engine.ts";
import { computeInThread } from "../../src/modules/lighttick/investments/strategies/strategy.compute.ts";
test("frozen algorithm versions cannot silently execute under another engine after recovery", async () => {
  const f = await strategyFixture(),
    w = await f.s.createRun(f.o, f.body, "algorithm-original"),
    raw = (await f.s.store.work(f.o, w.id))!;
  const input = {
    ...raw.input,
    algorithm_version: "synthetic-old-unsupported-version",
  };
  assert.throws(
    () => computeBacktest(input),
    /BACKTEST_ALGORITHM_VERSION_UNAVAILABLE/,
  );
  await assert.rejects(
    computeInThread(input, new AbortController().signal),
    /BACKTEST_ALGORITHM_VERSION_UNAVAILABLE/,
  );
  await f.repo.transaction(f.o, () =>
    f.s.store.saveWork({ ...raw, revision: 2, input }, 1),
  );
  await f.runner.execute(f.o, w.id);
  const done = await f.s.readRun(f.o, w.id);
  assert.equal(done.status, "failed");
  assert.equal(done.error_code, "BACKTEST_ALGORITHM_VERSION_UNAVAILABLE");
  assert.equal(done.output, null);
});
test("strategies retain originals, CAS and old versions; same-input worker reports and finite-grid comparison are deterministic", async () => {
  const f = await strategyFixture(),
    { s, o, d, body } = f;
  assert.equal(
    (
      await s.writeDefinition(
        o,
        d.id,
        { base_revision: 0, fields: f.fields },
        "strategy-original",
      )
    ).revision,
    1,
  );
  const v2 = await s.writeDefinition(
    o,
    d.id,
    {
      base_revision: 1,
      fields: {
        ...f.fields,
        description: "Cloud",
        config: { ...f.fields.config, entry_above: "12" },
      },
    },
    "version-two",
  );
  assert.equal(v2.revision, 2);
  assert.equal(
    (await s.readDefinition(o, d.id, 1)).fields.description,
    f.fields.description,
  );
  await assert.rejects(
    s.writeDefinition(
      o,
      d.id,
      { base_revision: 1, fields: f.fields },
      "stale-original",
    ),
    /changed/,
  );
  const queued = await s.createRun(o, body, "single-original");
  await f.runner.execute(o, queued.id);
  const done = await s.readRun(o, queued.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.output!.status, "complete");
  assert.equal(done.input.strategies[0].revision, 1);
  assert.equal(done.output!.cases[0].result.metrics!.net_profit, "200");
  const raw = (await s.store.work(o, queued.id))!;
  assert.equal(
    computeBacktest(raw.input).output_digest,
    raw.output!.output_digest,
  );
  assert.equal(
    (await computeInThread(raw.input, new AbortController().signal))
      .output_digest,
    raw.output!.output_digest,
  );
  assert.equal((await s.casePage(o, queued.id, 0, "trades")).items.length, 1);
  const first = await s.casePage(o, queued.id, 0, "equity", "", 2),
    last = await s.casePage(o, queued.id, 0, "equity", first.next_cursor!, 2);
  assert.equal(last.items.length, 2);
  await assert.rejects(
    s.casePage({ ...o, userId: "different-owner" }, queued.id, 0, "equity"),
  );
  const grid = await s.createRun(
    o,
    {
      ...body,
      mode: "grid",
      axes: [
        { parameter: "entry_above", values: ["10", "11"] },
        { parameter: "exit_below", values: ["8", "9"] },
      ],
    },
    "grid-original",
  );
  await f.runner.execute(o, grid.id);
  assert.equal((await s.readRun(o, grid.id)).output!.cases.length, 4);
  const compare = await s.createRun(
    o,
    {
      ...body,
      mode: "compare",
      strategies: [
        ...body.strategies,
        { id: d.id, version: 2, definition_digest: v2.definition_digest },
      ],
    },
    "compare-original",
  );
  await f.runner.execute(o, compare.id);
  assert.equal((await s.readRun(o, compare.id)).output!.cases.length, 2);
  const replay = await s.createRun(o, body, "single-original");
  assert.equal(replay.id, done.id);
  assert.equal(replay.status, "succeeded");
  await assert.rejects(
    s.createRun(o, { ...body, start_at: "2026-11-04" }, "single-original"),
    /identity/,
  );
});
test("missing execution facts and calendar gaps persist as incomplete; reviewed state cannot fabricate prices", async () => {
  const f = await strategyFixture(),
    { s, o, body } = f;
  const w = await s.createRun(
    o,
    { ...body, execution_review: null },
    "missing-facts",
  );
  await f.runner.execute(o, w.id);
  const done = await s.readRun(o, w.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.output!.status, "incomplete");
  assert.equal(done.output!.cases[0].result.metrics, null);
  const partial = await s.createRun(
    o,
    {
      ...body,
      execution_review: {
        ...body.execution_review,
        facts: body.execution_review.facts.slice(1),
      },
    },
    "partial-facts",
  );
  await f.runner.execute(o, partial.id);
  assert.equal((await s.readRun(o, partial.id)).output!.status, "incomplete");
  const raw = (await s.store.work(o, w.id))!;
  raw.input.execution_review = body.execution_review;
  raw.input.snapshot.dataset.bars.splice(1, 1);
  assert.equal(computeBacktest(raw.input).status, "incomplete");
  await assert.rejects(
    s.createRun(o, { ...body, input_digest: "a".repeat(64) }, "wrong-source"),
  );
  await assert.rejects(
    s.createRun(
      o,
      { ...body, decision_at: "2030-01-01T00:00:00Z" },
      "future-original",
    ),
  );
});
test("cancel, revocation and archive/restore fence late computation while ordinary edits retain frozen parameters", async () => {
  const f = await strategyFixture(),
    { s, o, body, d } = f;
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((r) => (started = r)),
    wait = new Promise<void>((r) => (release = r));
  const runner = new StrategyRunner(
    s,
    async () => {},
    async (input) => {
      started();
      await wait;
      return computeBacktest(input);
    },
  );
  const w = await s.createRun(o, body, "late-original"),
    run = runner.execute(o, w.id);
  await ready;
  await s.archiveDefinition(
    o,
    d.id,
    { base_revision: 1 },
    "archive-original",
    true,
  );
  await s.archiveDefinition(
    o,
    d.id,
    { base_revision: 2 },
    "restore-original",
    false,
  );
  release();
  await run;
  assert.equal((await s.readRun(o, w.id)).status, "failed");
  const historical = await s.createRun(o, body, "restored-old-version");
  await f.runner.execute(o, historical.id);
  assert.equal((await s.readRun(o, historical.id)).status, "succeeded");
  const cancel = await s.createRun(o, body, "cancel-original");
  await s.cancel(o, cancel.id, { base_revision: 1 }, "cancel-command");
  await f.runner.execute(o, cancel.id);
  assert.equal((await s.readRun(o, cancel.id)).status, "cancelled");
  const revoked = await s.createRun(o, body, "revoked-original");
  await new StrategyRunner(s, async () => {
    throw Error("revoked");
  }).execute(o, revoked.id);
  assert.equal((await s.readRun(o, revoked.id)).status, "failed");
});
test("receipt crash rolls back resource/work and expired lease recovery keeps one original identity", async () => {
  const f = await strategyFixture(),
    { s, o, body } = f,
    save = f.repo.saveOperation.bind(f.repo);
  f.repo.saveOperation = async () => {
    throw Error("receipt crash");
  };
  await assert.rejects(s.createRun(o, body, "receipt-crash"));
  assert.equal((await s.listRuns(o)).items.length, 0);
  assert.equal(await f.repo.getOperation(o, "receipt-crash"), undefined);
  f.repo.saveOperation = save;
  const w = await s.createRun(o, body, "recover-original"),
    raw = (await s.store.work(o, w.id))!;
  await f.repo.transaction(o, () =>
    s.store.saveWork(
      {
        ...raw,
        revision: 2,
        status: "running",
        attempt: 1,
        fence: "dead-worker",
        lease_until: "2026-11-06T08:00:10Z",
      },
      1,
    ),
  );
  await s.createRun(o, body, "recover-original");
  f.setTime("2026-11-06T08:00:11Z");
  assert.equal(await f.runner.recover(), 1);
  await f.runner.execute(o, w.id);
  const done = await s.readRun(o, w.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 2);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(computeInThread(raw.input, aborted.signal), /CANCELLED/);
});
test("active/daily budgets count retained cancelled work; originals remain replayable after exhaustion", async () => {
  const f = await strategyFixture(),
    { s, o, body } = f;
  const first = await s.createRun(o, body, "budget-000-original");
  await assert.rejects(s.createRun(o, body, "active-refused-original"), {
    statusCode: 429,
  });
  assert.equal(
    (await s.createRun(o, body, "budget-000-original")).id,
    first.id,
  );
  await s.cancel(o, first.id, { base_revision: 1 }, "budget-cancel-000");
  for (let n = 1; n < 20; n++) {
    const w = await s.createRun(o, body, "budget-original-" + n);
    await s.cancel(o, w.id, { base_revision: 1 }, "budget-cancel-" + n);
  }
  await assert.rejects(s.createRun(o, body, "daily-refused-original"), {
    statusCode: 429,
  });
  assert.equal(
    (await s.createRun(o, body, "budget-000-original")).status,
    "cancelled",
  );
  assert.equal((await s.listRuns(o)).items.length, 20);
});

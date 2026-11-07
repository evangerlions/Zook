import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ScreeningService } from "../../src/modules/lighttick/investments/screening/screen.service.ts";
import { ScreeningRunner } from "../../src/modules/lighttick/investments/screening/screen.runner.ts";
import { screen } from "../../src/modules/lighttick/investments/screening/screen.engine.ts";
import { exportScreening } from "../../src/modules/lighttick/investments/screening/screen.export.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Dedicated synthetic localhost database required");
test("PG screening CAS, rollback, late commit, persistent recovery/cancellation and exact historical provenance", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool);
  const o = { appId: "lighttick" as const, userId: "screen-pg-" + process.pid },
    queue = new InMemoryJobQueue();
  let time = new Date("2026-11-07T08:00:00Z");
  const clock = () => time,
    s = new ScreeningService(repo, queue, async () => {}, clock),
    restarted = new ScreeningService(other, queue, async () => {}, clock);
  const rid = "inv-screen-pg-rule",
    tid = "inv-screen-pg-template";
  const fields = {
    name: "PG exact rule",
    description: " retained\r\n description ",
    source_text: "",
    conditions: [
      {
        field: "close",
        op: "gte",
        value: "10.000000000000000000000000000001",
        upper_value: null,
        mapping: { source: "manual", quote: "", reason: "" },
      },
    ],
    combine: "all",
    sort_by: "close",
    descending: true,
    secondary_sort_by: null,
    secondary_descending: true,
    limit: 20,
    recipe: null,
    sort_mapping: { source: "manual", quote: "", reason: "" },
  };
  try {
    const i = (
      await s.createInstrument(
        o,
        { market: "SSE", code: "600000", kind: "stock", name: "Synthetic" },
        "symbol-original",
      )
    ).instrument;
    const rule = await s.writeDefinition(
      o,
      "rules",
      rid,
      { base_revision: 0, fields },
      "rule-original",
    );
    const tf = {
      name: "PG fixed pool",
      description: "",
      rule: { id: rid, version: 1, definition_digest: rule.definition_digest },
      instrument_ids: [i.id],
      account_id: null,
      enabled: true,
      tags: [],
    };
    await s.writeDefinition(
      o,
      "templates",
      tid,
      { base_revision: 0, fields: tf },
      "template-original",
    );
    const body = {
      template_id: tid,
      base_revision: 1,
      as_of: "2026-11-06",
      decision_at: time.toISOString(),
      sources: [
        {
          instrument_id: i.id,
          snapshot_id: null,
          input_digest: null,
          security_status: null,
        },
      ],
      consent: true,
    };
    const race = await Promise.allSettled(
      [s, restarted].map((service, j) =>
        service.writeDefinition(
          o,
          "rules",
          rid,
          { base_revision: 1, fields: { ...fields, name: "v2-" + j } },
          "race-original-" + j,
        ),
      ),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await restarted.definitionHistory(o, "rules", rid)).items.length,
      2,
    );
    assert.deepEqual(await restarted.readDefinition(o, "rules", rid, 1), rule);
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(s.createRun(o, body, "crashed-original"));
    await assert.rejects(
      s.writeDefinition(
        o,
        "rules",
        rid,
        { base_revision: 2, fields },
        "crashed-rule-original",
      ),
    );
    repo.saveOperation = save;
    assert.equal((await restarted.listRuns(o)).items.length, 0);
    assert.equal(
      (await restarted.definitionHistory(o, "rules", rid)).items.length,
      2,
    );
    assert.equal(await other.getOperation(o, "crashed-original"), undefined);
    const w = await s.createRun(o, body, "run-original");
    await repo.transaction(o, async () => {
      const raw = (await s.store.work(o, w.id))!;
      await s.store.saveWork(
        {
          ...raw,
          revision: 2,
          status: "running",
          attempt: 1,
          fence: "dead-worker",
          lease_until: "2026-11-07T08:00:10Z",
        },
        1,
      );
    });
    assert.equal(await new ScreeningRunner(restarted).recover(), 0);
    time = new Date("2026-11-07T08:01:00Z");
    assert.equal(await new ScreeningRunner(restarted).recover(), 1);
    await new ScreeningRunner(restarted).execute(o, w.id);
    const done = await restarted.readRun(o, w.id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.attempt, 2);
    assert.equal(done.input.rule.revision, 1);
    assert.equal(done.output!.unresolved, 1);
    assert.match(
      done.output!.evaluations[0].details[0].reason!,
      /^MISSING_SNAPSHOT/,
    );
    const raw = (await restarted.store.work(o, w.id))!;
    assert.deepEqual(done.output, await screen(raw.input));
    assert.equal((await restarted.createRun(o, body, "run-original")).id, w.id);
    await assert.rejects(restarted.readRun({ ...o, userId: "foreign" }, w.id), {
      statusCode: 404,
    });
    const page = await s.definitionHistory(o, "rules", rid, "", 1);
    assert.deepEqual(
      await restarted.definitionHistory(o, "rules", rid, page.next_cursor!, 1),
      await s.definitionHistory(o, "rules", rid, page.next_cursor!, 1),
    );
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      barrier = new Promise<void>((r) => (release = r));
    const pending = await s.createRun(o, body, "cancel-run-original");
    const computing = new ScreeningRunner(
      s,
      async () => {},
      async (input, signal) => {
        entered();
        await barrier;
        return screen(input, signal);
      },
    ).execute(o, pending.id);
    await started;
    const current = await restarted.readRun(o, pending.id);
    await restarted.cancel(
      o,
      pending.id,
      { base_revision: current.revision },
      "cancel-original",
    );
    release();
    await computing;
    assert.equal((await s.readRun(o, pending.id)).status, "cancelled");
    assert.equal((await s.readRun(o, pending.id)).output, null);
    let locked!: () => void, unlock!: () => void;
    const begun = new Promise<void>((r) => (locked = r)),
      hold = new Promise<void>((r) => (unlock = r));
    const archive = repo.transaction(o, async () => {
      await s.archiveDefinition(
        o,
        "templates",
        tid,
        { base_revision: 1 },
        "archive-original",
        true,
      );
      locked();
      await hold;
    });
    await begun;
    let settled = false;
    const late = restarted
      .createRun(o, body, "late-original")
      .finally(() => (settled = true));
    const rejection = assert.rejects(late, { statusCode: 409 });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(settled, false);
    unlock();
    await archive;
    await rejection;
    assert.equal(await other.getOperation(o, "late-original"), undefined);
    const exported = await repo.transaction(o, () => exportScreening(repo, o));
    assert.equal(exported.runs.length, 2);
    assert.equal(exported.versions.length, 4);
    assert.deepEqual(
      exported.runs
        .find((r) => r.id === pending.id)!
        .commands.map((c) => c.action),
      ["create", "cancel"],
    );
    assert.equal(JSON.stringify(exported).includes("dead-worker"), false);
    await other.deleteOwnerData(o);
    for (const table of [
      "screen_definitions",
      "screen_versions",
      "screen_work",
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
    await other.deleteOwnerData(o);
    await pool.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ObservationWorkService } from "../../src/modules/lighttick/investments/observations/observation.work-service.ts";
import { ObservationRunner } from "../../src/modules/lighttick/investments/observations/observation.runner.ts";
import { checkMonitor } from "../../src/modules/lighttick/investments/observations/observation.engine.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";
import { observationFixture } from "../support/lighttick-observation-fixture.ts";
import type {
  CheckInput,
  EvaluationReport,
} from "../../src/modules/lighttick/investments/observations/observation.types.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Dedicated synthetic localhost database required");
test("PG observations persist exact forecast sources/receipts and serialize late stop, CAS, rollback, lease recovery, calibration and owner deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    other = new PostgresLightTickRepository(pool),
    owner = {
      appId: "lighttick" as const,
      userId: "observation-pg-" + process.pid,
    };
  try {
    const f = await observationFixture(repo, owner.userId),
      { s, o, pid, evaluationBody } = f,
      second = new ObservationWorkService(
        other,
        f.queue,
        async () => {},
        s.clock,
      );
    const w = await s.createWork(
      o,
      "evaluation",
      pid,
      {
        ...evaluationBody,
        corporate_action_review: {
          unchanged: true,
          source_label: "Synthetic declared interval",
          available_at: evaluationBody.decision_at,
        },
      },
      "pg-evaluation-original",
    );
    const raw = (await s.store.work(o, w.id))!;
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
    const restart = new ObservationRunner(second);
    assert.equal(await restart.recover(), 1);
    await restart.execute(o, w.id);
    const done = await second.readWork(o, w.id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.attempt, 2);
    assert.equal((done.output as EvaluationReport).outcomes[0].correct, true);
    assert.equal((await second.calibration(o)).brier_score, "0.04");
    const before = (await second.listWorks(o)).items.length,
      save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt crash");
    };
    await assert.rejects(
      s.createWork(o, "evaluation", pid, evaluationBody, "crash-original"),
    );
    repo.saveOperation = save;
    assert.equal((await second.listWorks(o)).items.length, before);
    assert.equal(await other.getOperation(o, "crash-original"), undefined);
    const fb = {
        base_revision: 0,
        fields: {
          prediction_id: pid,
          evaluation_id: w.id,
          horizon: 1,
          reflection: "Exact original\r\n body ",
          learned: "Known",
          next_step: "Next",
        },
        consent: true,
      },
      fid = "inv-pg-observe-feedback";
    await s.write(o, "feedback", fid, fb, "feedback-original");
    const race = await Promise.allSettled(
      [s, second].map((svc, j) =>
        svc.write(
          o,
          "feedback",
          fid,
          {
            ...fb,
            base_revision: 1,
            fields: { ...fb.fields, reflection: "New " + j },
          },
          "feedback-race-original-" + j,
        ),
      ),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await second.history(o, "feedback", fid)).items.length, 2);
    assert.equal(
      ((await second.readObservation(o, "feedback", fid, 1)).fields as any)
        .reflection,
      fb.fields.reflection,
    );
    const mid = "inv-pg-observe-monitor";
    await s.write(
      o,
      "monitors",
      mid,
      { base_revision: 0, fields: f.monitorFields, consent: true },
      "monitor-original",
    );
    const check = await s.createWork(
      o,
      "check",
      mid,
      { base_revision: 1, consent: true },
      "check-original",
    );
    await restart.execute(o, check.id);
    assert.equal(
      (await second.readWork(o, check.id)).event_disposition,
      "created",
    );
    const events = await second.listObservations(o, "events");
    assert.equal(events.items.length, 1);
    await second.transition(
      o,
      "events",
      events.items[0].id,
      { base_revision: 1 },
      "read-event-original",
      "read",
    );
    f.setTime("2026-11-06T08:06:00Z");
    assert.equal(await restart.recover(), 1);
    const scheduled = (await second.listWorks(o)).items.find(
      (w) => w.resource_id === mid && w.status === "queued",
    )!;
    assert.ok(scheduled);
    await restart.execute(o, scheduled.id);
    assert.equal(
      (await second.readWork(o, scheduled.id)).event_disposition,
      "duplicate",
    );
    const late = await s.createWork(
      o,
      "check",
      mid,
      { base_revision: 1, consent: true },
      "late-check-original",
    );
    let start!: () => void, release!: () => void;
    const begun = new Promise<void>((r) => (start = r)),
      barrier = new Promise<void>((r) => (release = r));
    const computing = new ObservationRunner(
      s,
      async () => {},
      async (w, signal) => {
        start();
        await barrier;
        return checkMonitor(w.input as CheckInput, signal);
      },
    ).execute(o, late.id);
    await begun;
    let locked!: () => void, unlock!: () => void;
    const entered = new Promise<void>((r) => (locked = r)),
      hold = new Promise<void>((r) => (unlock = r));
    const stop = other.transaction(o, async () => {
      await second.transition(
        o,
        "monitors",
        mid,
        { base_revision: 1 },
        "stop-original",
        "stop",
      );
      locked();
      await hold;
    });
    await entered;
    let settled = false;
    const admission = s
      .createWork(
        o,
        "check",
        mid,
        { base_revision: 1, consent: true },
        "stopped-admission-original",
      )
      .finally(() => (settled = true));
    const rejection = assert.rejects(admission, { statusCode: 409 });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(settled, false);
    unlock();
    await stop;
    await rejection;
    release();
    await computing;
    assert.equal((await second.readWork(o, late.id)).status, "failed");
    assert.equal((await second.listObservations(o, "events")).items.length, 1);
    await assert.rejects(second.readWork({ ...o, userId: "foreign" }, w.id), {
      statusCode: 404,
    });
    const exported = await repo.transaction(o, () =>
      exportInvestments(repo, o),
    );
    assert.ok(exported.observations!.entries.find((e) => e.id === pid)?.frozen);
    assert.equal(exported.market.snapshots.length, 2);
    assert.equal(exported.observations!.works.length, 4);
    assert.equal(
      JSON.stringify(exported.observations).includes("lease_until"),
      false,
    );
    await other.deleteOwnerData(o);
    for (const table of [
      "observations",
      "observation_versions",
      "observation_work",
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

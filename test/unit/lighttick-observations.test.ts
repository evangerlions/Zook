import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observationFixture } from "../support/lighttick-observation-fixture.ts";
import { ObservationRunner } from "../../src/modules/lighttick/investments/observations/observation.runner.ts";
import { exportObservations } from "../../src/modules/lighttick/investments/observations/observation.export.ts";
import {
  evaluatePrediction,
  checkMonitor,
} from "../../src/modules/lighttick/investments/observations/observation.engine.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import type {
  EvaluationInput,
  EvaluationReport,
  PredictionFrozen,
  CheckInput,
} from "../../src/modules/lighttick/investments/observations/observation.types.ts";
const golden = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/lighttick/prediction-monitor-golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const reviewed = (body: any) => ({
  ...body,
  corporate_action_review: {
    unchanged: true,
    source_label: "Synthetic reviewed interval declaration",
    available_at: body.decision_at,
  },
});
test("immutable prediction, explicit unknown review, exact sessions/outcomes/calibration and versioned feedback without account", async () => {
  const f = await observationFixture(),
    { s, o, pid, evaluationBody, runner } = f;
  assert.equal((await f.repo.investments.accounts(o)).length, 0);
  const w = await s.createWork(
    o,
    "evaluation",
    pid,
    evaluationBody,
    "unreviewed-original",
  );
  await runner.execute(o, w.id);
  const unknown = await s.readWork(o, w.id);
  const outcomes = (unknown.output as EvaluationReport).outcomes;
  assert.deepEqual(
    outcomes.map((r) => r.target_date),
    golden.target_dates,
  );
  assert.deepEqual(
    outcomes.map((r) => r.state),
    golden.unreviewed_states,
  );
  assert.deepEqual(
    outcomes.map((r) => r.raw_return_pct),
    golden.raw_returns,
  );
  const good = await s.createWork(
    o,
    "evaluation",
    pid,
    reviewed(evaluationBody),
    "reviewed-original",
  );
  await runner.execute(o, good.id);
  const done = await s.readWork(o, good.id);
  assert.deepEqual(
    (done.output as EvaluationReport).outcomes.map((r) => r.state),
    golden.reviewed_states,
  );
  assert.deepEqual(
    (done.output as EvaluationReport).outcomes.map((r) => r.correct),
    golden.correct,
  );
  const { scope, read_only, ...stats } = await s.calibration(o);
  assert.deepEqual(stats, golden.calibration);
  assert.equal(read_only, true);
  const raw = (await s.store.work(o, good.id))!;
  assert.deepEqual(
    raw.output,
    await evaluatePrediction(raw.input as EvaluationInput),
  );
  assert.ok(
    !(
      "bars" in
      ((done.input as EvaluationInput).prediction.frozen as PredictionFrozen)
        .snapshot.dataset
    ),
  );
  await assert.rejects(
    s.write(
      o,
      "predictions",
      pid,
      { base_revision: 1, fields: f.predictionFields, consent: true },
      "edit-prediction-original",
    ),
    { statusCode: 409 },
  );
  const body = {
    base_revision: 0,
    fields: {
      prediction_id: pid,
      evaluation_id: good.id,
      horizon: 1,
      reflection: "  private\r\n reflection ",
      learned: "Known uncertainty",
      next_step: "Review next result",
    },
    consent: true,
  };
  const feedback = await s.write(
    o,
    "feedback",
    "inv-feedback-fixture",
    body,
    "feedback-original",
  );
  assert.equal((feedback.fields as any).reflection, body.fields.reflection);
  await s.write(
    o,
    "feedback",
    feedback.id,
    {
      ...body,
      base_revision: 1,
      fields: { ...body.fields, reflection: "Revised" },
    },
    "feedback-update-original",
  );
  assert.equal(
    ((await s.readObservation(o, "feedback", feedback.id, 1)).fields as any)
      .reflection,
    body.fields.reflection,
  );
  const exported = await exportObservations(f.repo, o);
  assert.equal(exported.works.length, 2);
  assert.equal(exported.versions.length, 3);
  assert.equal(
    (exported.works[0].input as EvaluationInput).prediction.frozen !==
      undefined,
    true,
  );
  assert.equal(
    (
      await s.createWork(
        o,
        "evaluation",
        pid,
        reviewed(evaluationBody),
        "reviewed-original",
      )
    ).id,
    good.id,
  );
});
test("missing/conflicting interval, unreviewed actions, flat price, timestamp and same-price spellings cannot invent successful outcomes", async () => {
  const f = await observationFixture(),
    w = await f.s.createWork(
      f.o,
      "evaluation",
      f.pid,
      reviewed(f.evaluationBody),
      "engine-boundary-original",
    ),
    raw = (await f.s.store.work(f.o, w.id))!,
    input = raw.input as EvaluationInput;
  const clone = () => structuredClone(input);
  const missing = clone();
  missing.snapshots[0].dataset.bars = missing.snapshots[0].dataset.bars.filter(
    (b) => b.date !== "2026-11-04",
  );
  assert.equal(
    (await evaluatePrediction(missing)).outcomes[1].reason,
    "MISSING_INTERVAL_QUOTE",
  );
  const conflict = clone();
  const source = structuredClone(conflict.snapshots[0]);
  source.id = "inv-conflict-fixture";
  source.dataset.bars[0].close = "12";
  conflict.snapshots.push(source);
  assert.equal(
    (await evaluatePrediction(conflict)).outcomes[0].reason,
    "CONFLICTING_TARGET_QUOTES",
  );
  const same = clone();
  const equivalent = structuredClone(same.snapshots[0]);
  equivalent.id = "inv-equivalent-fixture";
  equivalent.dataset.bars[0].close = "11.0";
  same.snapshots.push(equivalent);
  assert.equal((await evaluatePrediction(same)).outcomes[0].state, "resolved");
  for (const direction of ["up", "down"] as const) {
    const flat = clone();
    flat.prediction.fields.direction = direction;
    flat.snapshots[0].dataset.bars[0].close = "10";
    assert.equal((await evaluatePrediction(flat)).outcomes[0].correct, false);
  }
  const unknown = clone();
  unknown.corporate_action_review!.unchanged = false;
  assert.equal((await evaluatePrediction(unknown)).outcomes[0].correct, null);
  const during = clone();
  during.decision_at = "2026-11-03T06:00:00Z";
  during.as_of = "2026-11-03";
  assert.equal((await evaluatePrediction(during)).outcomes[0].state, "pending");
  await assert.rejects(
    f.s.createWork(
      f.o,
      "evaluation",
      f.pid,
      { ...reviewed(f.evaluationBody), decision_at: "2026-11-07T08:00:00Z" },
      "future-decision-original",
    ),
    { statusCode: 422 },
  );
});
test("monitor chosen source, event deduplication, read CAS, cooldown and stop block admission and delayed events", async () => {
  const f = await observationFixture(),
    { s, o, runner } = f,
    mid = "inv-monitor-fixture";
  await s.write(
    o,
    "monitors",
    mid,
    { base_revision: 0, fields: f.monitorFields, consent: true },
    "monitor-original",
  );
  const body = { base_revision: 1, consent: true };
  const w = await s.createWork(o, "check", mid, body, "monitor-check-original");
  await runner.execute(o, w.id);
  const done = await s.readWork(o, w.id);
  assert.equal((done.output as any).state, "triggered");
  assert.equal(done.event_disposition, "created");
  const events = await s.listObservations(o, "events");
  assert.equal(events.items.length, 1);
  const event = events.items[0];
  await s.transition(
    o,
    "events",
    event.id,
    { base_revision: 1 },
    "read-event-original",
    "read",
  );
  assert.equal(
    (await s.listObservations(o, "events", "", 20, false, undefined, true))
      .items.length,
    0,
  );
  await assert.rejects(
    s.transition(
      o,
      "events",
      event.id,
      { base_revision: 1 },
      "stale-read-event",
      "read",
    ),
    { statusCode: 409 },
  );
  const duplicate = await s.createWork(
    o,
    "check",
    mid,
    body,
    "monitor-duplicate-original",
  );
  await runner.execute(o, duplicate.id);
  assert.equal(
    (await s.readWork(o, duplicate.id)).event_disposition,
    "duplicate",
  );
  assert.equal((await s.listObservations(o, "events")).items.length, 1);
  const late = await s.createWork(
    o,
    "check",
    mid,
    body,
    "monitor-late-original",
  );
  let begin!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (begin = r)),
    barrier = new Promise<void>((r) => (release = r));
  const running = new ObservationRunner(
    s,
    async () => {},
    async (w, signal) => {
      begin();
      await barrier;
      return checkMonitor(w.input as CheckInput, signal);
    },
  ).execute(o, late.id);
  await started;
  await s.transition(
    o,
    "monitors",
    mid,
    { base_revision: 1 },
    "stop-monitor-original",
    "stop",
  );
  release();
  await running;
  assert.equal((await s.readWork(o, late.id)).status, "failed");
  assert.equal((await s.listObservations(o, "events")).items.length, 1);
  await assert.rejects(
    s.createWork(
      o,
      "check",
      mid,
      { base_revision: 2, consent: true },
      "stopped-check-original",
    ),
    { statusCode: 409 },
  );
  const exported = await exportObservations(f.repo, o);
  assert.ok(
    exported.versions.some((r) => r.kind === "events" && r.revision === 2),
  );
  assert.equal(JSON.stringify(exported).includes("lease_until"), false);
});
test("owner/resource/original boundaries, receipt rollback, archive, cursor replay and invalidation retain all history", async () => {
  const f = await observationFixture(),
    { s, o, pid, evaluationBody } = f;
  await assert.rejects(
    s.readObservation({ ...o, userId: "foreign" }, "predictions", pid),
    { statusCode: 404 },
  );
  const save = f.repo.saveOperation.bind(f.repo);
  f.repo.saveOperation = async () => {
    throw Error("receipt crash");
  };
  await assert.rejects(
    s.createWork(o, "evaluation", pid, evaluationBody, "crashed-original"),
  );
  assert.equal((await s.listWorks(o)).items.length, 0);
  f.repo.saveOperation = save;
  await s.transition(
    o,
    "predictions",
    pid,
    { base_revision: 1 },
    "archive-prediction-original",
    "archive",
  );
  await assert.rejects(
    s.createWork(
      o,
      "evaluation",
      pid,
      { ...evaluationBody, base_revision: 2 },
      "archived-original",
    ),
    { statusCode: 409 },
  );
  await s.transition(
    o,
    "predictions",
    pid,
    { base_revision: 2 },
    "restore-prediction-original",
    "restore",
  );
  const page = await s.history(o, "predictions", pid, "", 1);
  assert.ok(page.next_cursor);
  assert.deepEqual(
    await s.history(o, "predictions", pid, page.next_cursor!, 1),
    await s.history(o, "predictions", pid, page.next_cursor!, 1),
  );
  await s.transition(
    o,
    "predictions",
    pid,
    { base_revision: 3 },
    "archive-second-original",
    "archive",
  );
  await assert.rejects(s.history(o, "predictions", pid, page.next_cursor!, 1), {
    statusCode: 409,
  });
  for (const id of ["inv-monitor-one-fixture", "inv-monitor-two-fixture"])
    await s.write(
      o,
      "monitors",
      id,
      { base_revision: 0, fields: f.monitorFields, consent: true },
      "save-" + id,
    );
  await s.createWork(
    o,
    "check",
    "inv-monitor-one-fixture",
    { base_revision: 1, consent: true },
    "shared-request-original",
  );
  await assert.rejects(
    s.createWork(
      o,
      "check",
      "inv-monitor-two-fixture",
      { base_revision: 1, consent: true },
      "shared-request-original",
    ),
    { statusCode: 409 },
  );
  await f.repo.deleteOwnerData(o);
  assert.equal((await s.listObservations(o, "predictions")).items.length, 0);
  assert.equal((await s.listWorks(o)).items.length, 0);
});
test("worker recovery, cancel originals, revoked queued terminal and scheduler source ambiguity remain explicit", async () => {
  const f = await observationFixture(),
    { s, o } = f,
    w = await s.createWork(
      o,
      "evaluation",
      f.pid,
      f.evaluationBody,
      "recover-original",
    );
  let raw = (await s.store.work(o, w.id))!;
  await s.store.saveWork(
    {
      ...raw,
      revision: 2,
      status: "running",
      attempt: 1,
      fence: "crashed-worker",
      lease_until: "2026-11-06T08:00:01Z",
    },
    1,
  );
  const queuedBefore = f.queue.jobs.length;
  assert.equal(
    (
      await s.createWork(
        o,
        "evaluation",
        f.pid,
        f.evaluationBody,
        "recover-original",
      )
    ).status,
    "running",
  );
  assert.equal(
    f.queue.jobs.length,
    queuedBefore,
    "An active lease replay must not consume the next recovery job ID",
  );
  f.setTime("2026-11-06T08:01:00Z");
  await f.runner.recover();
  assert.equal(f.queue.jobs.length, queuedBefore + 1);
  await f.runner.execute(o, w.id);
  assert.equal((await s.readWork(o, w.id)).attempt, 2);
  const cancelled = await s.createWork(
    o,
    "evaluation",
    f.pid,
    f.evaluationBody,
    "cancel-create-original",
  );
  await s.cancel(o, cancelled.id, { base_revision: 1 }, "cancel-original");
  await f.runner.execute(o, cancelled.id);
  assert.equal((await s.readWork(o, cancelled.id)).status, "cancelled");
  assert.deepEqual(
    (await exportObservations(f.repo, o)).works
      .find((r) => r.id === cancelled.id)!
      .commands.map((c) => c.action),
    ["create", "cancel"],
  );
  const revoked = await s.createWork(
    o,
    "evaluation",
    f.pid,
    f.evaluationBody,
    "revoked-original",
  );
  await new ObservationRunner(s, async () => {
    throw Error("revoked");
  }).execute(o, revoked.id);
  assert.equal((await s.readWork(o, revoked.id)).status, "failed");
  await s.write(
    o,
    "monitors",
    "inv-auto-monitor",
    { base_revision: 0, fields: f.monitorFields, consent: true },
    "auto-monitor-original",
  );
  await f.repo.investments.market.publish(o, {
    ...structuredClone(f.daily),
    id: "inv-second-source-fixture",
    work_id: "inv-second-source-work",
  });
  assert.equal(await f.runner.recover(), 1);
  const works = await s.listWorks(o),
    auto = works.items.find((w) => w.kind === "check")!;
  await f.runner.execute(o, auto.id);
  const done = await s.readWork(o, auto.id);
  assert.equal((done.output as any).state, "unknown");
  assert.equal((done.output as any).reason, "AMBIGUOUS_CONFIGURED_SOURCE");
  assert.equal((await s.listObservations(o, "events")).items.length, 0);
});
test("monitor new-date cooldown is persistent, calendar/MA/zero-volume unknowns do not emit facts", async () => {
  const f = await observationFixture(),
    { s, o } = f,
    mid = "inv-monitor-cooldown";
  await s.write(
    o,
    "monitors",
    mid,
    {
      base_revision: 0,
      fields: { ...f.monitorFields, cooldown_seconds: 604800 },
      consent: true,
    },
    "cooldown-monitor-original",
  );
  let w = await s.createWork(
    o,
    "check",
    mid,
    { base_revision: 1, consent: true },
    "cooldown-first-original",
  );
  await f.runner.execute(o, w.id);
  assert.equal((await s.readWork(o, w.id)).event_disposition, "created");
  f.setTime("2026-11-09T08:00:00Z");
  await f.publishSource(
    f.snapshot(
      "inv-next-date-fixture",
      ["2026-11-09"],
      ["15"],
      "2026-11-09T08:00:00Z",
    ),
  );
  w = await s.createWork(
    o,
    "check",
    mid,
    { base_revision: 1, consent: true },
    "cooldown-next-original",
  );
  await f.runner.execute(o, w.id);
  assert.equal((await s.readWork(o, w.id)).event_disposition, "cooldown");
  assert.equal((await s.listObservations(o, "events")).items.length, 1);
  const raw = (await s.store.work(o, w.id))!,
    input = structuredClone(raw.input) as CheckInput;
  input.monitor.fields.field = "ma_bullish";
  assert.equal((await checkMonitor(input)).reason, "WINDOW_MISSING");
  input.calendar.status = "coverage_unknown";
  assert.equal((await checkMonitor(input)).reason, "CALENDAR_UNAVAILABLE");
  input.calendar.status = "available";
  const volume = structuredClone(input);
  volume.monitor.fields.field = "volume_ratio_5";
  volume.monitor.fields.op = "gt";
  volume.monitor.fields.threshold = "1.2";
  volume.snapshot!.dataset.calendar = volume.calendar as any;
  volume.snapshot!.dataset.bars = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-09",
  ].map((date) => ({
    date,
    open: "10",
    high: "10",
    low: "10",
    close: "10",
    volume_shares: "0",
    amount_cny: "0",
    turnover_rate_pct: null,
  }));
  const zero = await checkMonitor(volume);
  assert.equal(zero.state, "unknown");
  assert.match(zero.reason!, /^FIELDS_INVALID/);
  const weekend = structuredClone(input);
  weekend.as_of = "2026-11-07";
  weekend.decision_at = "2026-11-07T08:00:00Z";
  assert.equal((await checkMonitor(weekend)).state, "closed");
  input.decision_at = "2026-11-09T06:00:00Z";
  assert.equal((await checkMonitor(input)).state, "waiting_for_close");
});
test("active and daily limits preserve originals; same-time registrations have stable increasing owner sequence", async () => {
  const f = await observationFixture(),
    { s, o } = f;
  const one = await s.createWork(
      o,
      "evaluation",
      f.pid,
      f.evaluationBody,
      "budget-first-original",
    ),
    two = await s.createWork(
      o,
      "evaluation",
      f.pid,
      f.evaluationBody,
      "budget-second-original",
    );
  await assert.rejects(
    s.createWork(
      o,
      "evaluation",
      f.pid,
      f.evaluationBody,
      "budget-active-third",
    ),
    { statusCode: 429 },
  );
  assert.equal(one.sequence, 1);
  assert.equal(two.sequence, 2);
  await f.runner.execute(o, one.id);
  await f.runner.execute(o, two.id);
  for (let n = 3; n <= 40; n++) {
    const w = await s.createWork(
      o,
      "evaluation",
      f.pid,
      f.evaluationBody,
      "budget-original-" + n,
    );
    assert.equal(w.sequence, n);
    await f.runner.execute(o, w.id);
  }
  await assert.rejects(
    s.createWork(
      o,
      "evaluation",
      f.pid,
      f.evaluationBody,
      "budget-overflow-original",
    ),
    { statusCode: 429 },
  );
  assert.equal(
    (
      await s.createWork(
        o,
        "evaluation",
        f.pid,
        f.evaluationBody,
        "budget-first-original",
      )
    ).id,
    one.id,
  );
  assert.equal((await s.listWorks(o, "", 50)).items.length, 40);
});
test("late result cannot resurrect a prediction across archive then restore; mid-session registration counts only later opens", async () => {
  const f = await observationFixture(),
    { s, o } = f;
  f.setTime("2026-11-03T02:00:00Z");
  await s.write(
    o,
    "predictions",
    "inv-mid-session-prediction",
    { base_revision: 0, fields: f.predictionFields, consent: true },
    "mid-session-original",
  );
  f.setTime("2026-11-06T08:00:00Z");
  const w = await s.createWork(
    o,
    "evaluation",
    "inv-mid-session-prediction",
    {
      ...f.evaluationBody,
      corporate_action_review: {
        unchanged: true,
        source_label: "Synthetic reviewed",
        available_at: f.evaluationBody.decision_at,
      },
    },
    "mid-session-evaluate",
  );
  let begin!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (begin = r)),
    barrier = new Promise<void>((r) => (release = r));
  const run = new ObservationRunner(
    s,
    async () => {},
    async (w, signal) => {
      const output = await evaluatePrediction(
        w.input as EvaluationInput,
        signal,
      );
      assert.equal(output.outcomes[0].target_date, "2026-11-04");
      begin();
      await barrier;
      return output;
    },
  ).execute(o, w.id);
  await started;
  await s.transition(
    o,
    "predictions",
    "inv-mid-session-prediction",
    { base_revision: 1 },
    "mid-session-archive",
    "archive",
  );
  await s.transition(
    o,
    "predictions",
    "inv-mid-session-prediction",
    { base_revision: 2 },
    "mid-session-restore",
    "restore",
  );
  release();
  await run;
  assert.equal((await s.readWork(o, w.id)).status, "failed");
});

test("late-November horizons retain available calendar coverage and a renamed instrument can start a new frozen evaluation", async () => {
  const f = await observationFixture(),
    { s, o } = f;
  f.setTime("2026-11-20T08:00:00Z");
  const baseline = await f.publishSource(
    f.snapshot(
      "inv-late-november-baseline",
      ["2026-11-20"],
      ["20"],
      "2026-11-20T08:00:00Z",
    ),
  );
  const fields = {
    ...f.predictionFields,
    baseline: {
      snapshot_id: baseline.id,
      input_digest: baseline.dataset.input_digest,
      date: "2026-11-20",
    },
  };
  await s.write(
    o,
    "predictions",
    "inv-late-november-forecast",
    { base_revision: 0, fields, consent: true },
    "late-november-forecast",
  );
  f.setTime("2026-11-23T08:00:00Z");
  const source = await f.publishSource(
    f.snapshot(
      "inv-late-november-source",
      ["2026-11-23"],
      ["21"],
      "2026-11-23T08:00:00Z",
    ),
  );
  await s.updateInstrument(
    o,
    f.instrument.id,
    { base_revision: 1, name: "Renamed synthetic", archived: false },
    "renamed-instrument-original",
  );
  const w = await s.createWork(
    o,
    "evaluation",
    "inv-late-november-forecast",
    {
      base_revision: 1,
      as_of: "2026-11-23",
      decision_at: "2026-11-23T08:00:00Z",
      sources: [{ id: source.id, input_digest: source.dataset.input_digest }],
      corporate_action_review: {
        unchanged: true,
        source_label: "Synthetic declaration",
        available_at: "2026-11-23T08:00:00Z",
      },
      consent: true,
    },
    "late-november-evaluation",
  );
  await f.runner.execute(o, w.id);
  const done = await s.readWork(o, w.id);
  assert.equal(done.status, "succeeded");
  assert.equal((done.output as EvaluationReport).outcomes[0].correct, true);
  assert.equal((done.input as EvaluationInput).instrument.revision, 2);
});

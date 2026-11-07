import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ScreeningService } from "../../src/modules/lighttick/investments/screening/screen.service.ts";
import { ScreeningRunner } from "../../src/modules/lighttick/investments/screening/screen.runner.ts";
import { screen } from "../../src/modules/lighttick/investments/screening/screen.engine.ts";
import { exportScreening } from "../../src/modules/lighttick/investments/screening/screen.export.ts";
import { ruleFields } from "../../src/modules/lighttick/investments/screening/screen.validation.ts";
const o = { appId: "lighttick" as const, userId: "screening-synthetic" },
  rid = "inv-screen-rule-fixture",
  tid = "inv-screen-template-fixture",
  clock = () => new Date("2026-11-07T08:00:00Z");
const mapping = { source: "manual", quote: "", reason: "" };
const fields = {
  name: "Synthetic rule",
  description: "  exact description\r\n ",
  source_text: "收盘价至少10元",
  conditions: [
    {
      field: "close",
      op: "gte",
      value: "10",
      upper_value: null,
      mapping: { source: "explicit", quote: "收盘价至少10元", reason: "" },
    },
  ],
  combine: "all",
  sort_by: "close",
  descending: true,
  secondary_sort_by: null,
  secondary_descending: true,
  limit: 20,
  recipe: null,
  sort_mapping: mapping,
};
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    s = new ScreeningService(
      repo,
      new InMemoryJobQueue(),
      async () => {},
      clock,
    ),
    i = (
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
    name: "Synthetic template",
    description: "Pool",
    rule: { id: rid, version: 1, definition_digest: rule.definition_digest },
    instrument_ids: [i.id],
    account_id: null,
    enabled: true,
    tags: ["synthetic"],
  };
  await s.writeDefinition(
    o,
    "templates",
    tid,
    { base_revision: 0, fields: tf },
    "template-original",
  );
  const snapshot: any = {
    id: "inv-screen-market-fixture",
    revision: 1,
    instrument_id: i.id,
    instrument_revision: 1,
    work_id: "inv-work-fixture",
    created_at: clock().toISOString(),
    indicators: {},
    dataset: {
      supplier: "csv",
      adapter_version: "synthetic",
      instrument_id: i.id,
      code: i.code,
      market: "SSE",
      kind: "stock",
      start: "2026-11-06",
      end: "2026-11-06",
      price_basis: "unadjusted",
      realtime: false,
      retrieved_at: "2026-11-06T08:00:00Z",
      available_at: "2026-11-06T08:00:00Z",
      source_units: { volume: "shares", amount: "CNY" },
      calendar: {
        status: "available",
        version: "synthetic",
        review_until: "2026-11-27",
        sessions: { "2026-11-06": true },
      },
      missing_sessions: [],
      bars: [
        {
          date: "2026-11-06",
          open: "11",
          high: "12",
          low: "10",
          close: "11",
          volume_shares: "100",
          amount_cny: "1100",
          turnover_rate_pct: null,
        },
      ],
      input_digest: "a".repeat(64),
      limitations: ["Synthetic only"],
    },
  };
  await repo.investments.market.publish(o, snapshot);
  const body = {
    template_id: tid,
    base_revision: 1,
    as_of: "2026-11-06",
    decision_at: clock().toISOString(),
    sources: [
      {
        instrument_id: i.id,
        snapshot_id: snapshot.id,
        input_digest: snapshot.dataset.input_digest,
        security_status: null,
      },
    ],
    consent: true,
  };
  return { repo, s, body, tf, i, rule, snapshot };
}
test("versioned rules/templates freeze exact old versions and sources; worker outputs explainable reproducible result without account", async () => {
  const { repo, s, body, tf } = await setup();
  assert.equal((await repo.investments.accounts(o)).length, 0);
  const w = await s.createRun(o, body, "run-original");
  await s.writeDefinition(
    o,
    "rules",
    rid,
    {
      base_revision: 1,
      fields: {
        ...fields,
        name: "Rule v2",
        conditions: [{ ...fields.conditions[0], value: "20", mapping }],
      },
    },
    "rule-update-original",
  );
  await s.writeDefinition(
    o,
    "templates",
    tid,
    { base_revision: 1, fields: { ...tf, name: "Template v2" } },
    "template-update-original",
  );
  await new ScreeningRunner(s).execute(o, w.id);
  const done = await s.readRun(o, w.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.input.rule.revision, 1);
  assert.equal(done.input.template.revision, 1);
  assert.equal(done.output!.total, 1);
  assert.equal(done.output!.evaluations[0].details[0].actual, "11");
  assert.deepEqual(done.output!.evaluations[0].details[0].dates, [
    "2026-11-06",
  ]);
  assert.equal((await s.createRun(o, body, "run-original")).id, w.id);
  const raw = await s.store.work(o, w.id);
  assert.equal(
    done.output!.output_digest,
    (await screen(raw!.input)).output_digest,
  );
  assert.equal(
    (await s.readDefinition(o, "rules", rid, 1)).fields.name,
    "Synthetic rule",
  );
  assert.equal(
    (await s.readDefinition(o, "rules", rid)).fields.name,
    "Rule v2",
  );
  assert.equal(
    (await exportScreening(repo, o)).runs[0].commands[0].key,
    "run-original",
  );
});
test("definition CAS, owner/digest/resource boundaries, archive and cursor invalidation preserve exact originals", async () => {
  const { s, tf, body } = await setup();
  await assert.rejects(
    s.readDefinition({ ...o, userId: "foreign" }, "rules", rid),
    { statusCode: 404 },
  );
  await assert.rejects(
    s.writeDefinition(
      o,
      "templates",
      "inv-wrong-rule-template",
      {
        base_revision: 0,
        fields: {
          ...tf,
          rule: { ...tf.rule, definition_digest: "b".repeat(64) },
        },
      },
      "bad-rule-digest",
    ),
    { statusCode: 404 },
  );
  await assert.rejects(
    s.writeDefinition(
      o,
      "rules",
      rid,
      { base_revision: 1, fields },
      "rule-original",
    ),
    { statusCode: 409 },
  );
  await s.archiveDefinition(
    o,
    "rules",
    rid,
    { base_revision: 1 },
    "archive-rule-original",
    true,
  );
  await assert.rejects(s.createRun(o, body, "archived-run-original"), {
    statusCode: 409,
  });
  await s.archiveDefinition(
    o,
    "rules",
    rid,
    { base_revision: 2 },
    "restore-rule-original",
    false,
  );
  const first = await s.definitionHistory(o, "rules", rid, "", 1);
  assert.ok(first.next_cursor);
  assert.deepEqual(
    await s.definitionHistory(o, "rules", rid, first.next_cursor!, 1),
    await s.definitionHistory(o, "rules", rid, first.next_cursor!, 1),
  );
  await s.writeDefinition(
    o,
    "rules",
    rid,
    { base_revision: 3, fields },
    "rule-revision-four",
  );
  await assert.rejects(
    s.definitionHistory(o, "rules", rid, first.next_cursor!, 1),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.writeDefinition(
      o,
      "rules",
      rid,
      { base_revision: 1, fields },
      "stale-rule-original",
    ),
    { statusCode: 409 },
  );
});
test("original receipt failure rolls back work/versions, missing source is unknown, future knowledge and pool mismatch refused", async () => {
  const { repo, s, body } = await setup();
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("receipt crash");
  };
  await assert.rejects(s.createRun(o, body, "crashed-run-original"));
  assert.equal((await s.store.works(o)).length, 0);
  await assert.rejects(
    s.writeDefinition(
      o,
      "rules",
      rid,
      { base_revision: 1, fields },
      "crashed-rule-original",
    ),
  );
  assert.equal((await s.readDefinition(o, "rules", rid)).revision, 1);
  repo.saveOperation = save;
  await assert.rejects(
    s.createRun(
      o,
      { ...body, decision_at: "2026-11-05T08:00:00Z" },
      "future-source-original",
    ),
    { statusCode: 422 },
  );
  await assert.rejects(
    s.createRun(
      o,
      {
        ...body,
        sources: [{ ...body.sources[0], instrument_id: "inv-foreign-fixture" }],
      },
      "pool-mismatch-original",
    ),
    { statusCode: 422 },
  );
  const w = await s.createRun(
    o,
    {
      ...body,
      sources: [{ ...body.sources[0], snapshot_id: null, input_digest: null }],
    },
    "missing-source-original",
  );
  await new ScreeningRunner(s).execute(o, w.id);
  const done = await s.readRun(o, w.id);
  assert.equal(done.output!.unresolved, 1);
  assert.equal(done.output!.items.length, 0);
  assert.match(
    done.output!.evaluations[0].details[0].reason!,
    /MISSING_SNAPSHOT/,
  );
});
test("cancel/disable and revocation fence late results; export has cancellation originals and shared delete covers history", async () => {
  const { repo, s, body, tf } = await setup();
  const w = await s.createRun(o, body, "cancel-run-original");
  let start!: () => void, release!: () => void;
  const begun = new Promise<void>((r) => (start = r)),
    barrier = new Promise<void>((r) => (release = r));
  const runner = new ScreeningRunner(
    s,
    async () => {},
    async (input, signal) => {
      start();
      await barrier;
      return screen(input, signal);
    },
  );
  const run = runner.execute(o, w.id);
  await begun;
  const current = await s.readRun(o, w.id);
  await s.cancel(
    o,
    w.id,
    { base_revision: current.revision },
    "cancel-original",
  );
  release();
  await run;
  assert.equal((await s.readRun(o, w.id)).status, "cancelled");
  const e = await exportScreening(repo, o);
  assert.deepEqual(
    e.runs[0].commands.map((c) => c.action),
    ["create", "cancel"],
  );
  await s.writeDefinition(
    o,
    "templates",
    tid,
    { base_revision: 1, fields: { ...tf, enabled: false } },
    "stop-template-original",
  );
  await assert.rejects(
    s.createRun(o, { ...body, base_revision: 2 }, "stopped-run-original"),
    { statusCode: 409 },
  );
  await repo.deleteOwnerData(o);
  assert.equal((await s.store.works(o)).length, 0);
  assert.equal((await s.store.definitions(o, "rules")).length, 0);
});
test("explicit source thresholds/windows cannot drift and provenance suggestions require explanations", () => {
  assert.throws(() =>
    ruleFields({
      ...fields,
      conditions: [{ ...fields.conditions[0], value: "9" }],
    }),
  );
  assert.throws(() =>
    ruleFields({
      ...fields,
      conditions: [{ ...fields.conditions[0], op: "gt" }],
    }),
  );
  assert.throws(() =>
    ruleFields({
      ...fields,
      conditions: [
        {
          ...fields.conditions[0],
          mapping: { source: "suggested", quote: "", reason: "" },
        },
      ],
    }),
  );
  assert.equal(ruleFields(fields).description, fields.description);
});
test("revoked queued work is terminal without computing or endlessly requeueing", async () => {
  const { s, body } = await setup();
  const w = await s.createRun(o, body, "revoked-run-original");
  let called = false;
  await new ScreeningRunner(
    s,
    async () => {
      throw Error("revoked");
    },
    async (input) => {
      called = true;
      return screen(input);
    },
  ).execute(o, w.id);
  assert.equal(called, false);
  assert.equal(
    (await s.readRun(o, w.id)).error_code,
    "SCREEN_PERMISSION_REVOKED",
  );
  assert.equal((await s.readRun(o, w.id)).status, "failed");
});

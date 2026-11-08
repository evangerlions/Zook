import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
const o = { appId: "lighttick" as const, userId: "form-sections-synthetic" };
const decision = {
  date: "2026-11-08",
  probability: 60,
  title: "Synthetic decision",
  context: "Context",
  options: "A/B",
  reason: "Reason",
  expected: "Expected",
  emotion: "Calm",
  actual: "",
  bias: "",
  historical_extra: "Preserve",
};
test("section write preserves other sections and unknown historical fields, and CAS rejects a stale second tab", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new FormRecordsService(repo);
  await s.save(
    o,
    {
      base_revision: 0,
      data: {
        ...emptyFormRecords(),
        habits: { "2026-11-08": { minutes: 25, note: "Keep" } },
      },
    },
    "section-seed",
  );
  const first = await s.patch(
    o,
    "decisions",
    { base_revision: 1, value: [decision] },
    "section-original",
  );
  assert.equal(first.data.habits["2026-11-08"].minutes, 25);
  assert.equal(first.data.decisions[0].historical_extra, "Preserve");
  assert.deepEqual(
    await s.patch(
      o,
      "decisions",
      { base_revision: 1, value: [decision] },
      "section-original",
    ),
    first,
  );
  await assert.rejects(
    s.patch(o, "todos", { base_revision: 1, value: [] }, "section-stale"),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.patch(
      o,
      "predictions",
      { base_revision: 1, value: [decision] },
      "section-original",
    ),
    { statusCode: 409 },
  );
  assert.equal((await s.read(o)).revision, 2);
});
test("section receipt failure rolls back only candidate and rechecks owner authorization on replay", async () => {
  const repo = new InMemoryLightTickRepository();
  let allowed = true;
  const s = new FormRecordsService(repo, async () => {
    if (!allowed) throw Error("revoked");
  });
  const original = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("crash");
  };
  await assert.rejects(
    s.patch(
      o,
      "reviews",
      {
        base_revision: 0,
        value: [
          {
            date: "2026-11-08",
            thought: "Before",
            actual: "After",
            gap: "Difference",
            action: "Next text only",
          },
        ],
      },
      "section-review",
    ),
  );
  assert.equal((await s.read(o)).revision, 0);
  repo.saveOperation = original;
  const body = {
    base_revision: 0,
    value: [
      { date: "2026-11-08", insight: "Saved observation", source: "Source" },
    ],
  };
  await s.patch(o, "insights", body, "section-insight");
  allowed = false;
  await assert.rejects(
    s.patch(o, "insights", body, "section-insight"),
    /revoked/,
  );
  assert.equal(
    (await new FormRecordsService(repo).read({ ...o, userId: "other-owner" }))
      .revision,
    0,
  );
  assert.equal((await repo.listTasks(o)).length, 0);
  assert.equal((await repo.listReflections(o)).length, 0);
});
test("custom field removal requires removal of associated cells and never changes unrelated form data", async () => {
  const s = new FormRecordsService(new InMemoryLightTickRepository());
  const custom = {
    customFields: [{ key: "f-reading", label: "Reading", type: "number" }],
    customRecords: [{ "f-reading": 0, legacy_note: "Keep source" }],
  };
  const first = await s.patch(
    o,
    "custom",
    { base_revision: 0, value: custom },
    "custom-original",
  );
  assert.equal(first.data.customRecords[0]["f-reading"], 0);
  await assert.rejects(
    s.patch(
      o,
      "custom",
      {
        base_revision: 1,
        value: { customFields: [], customRecords: custom.customRecords },
      },
      "custom-orphan",
    ),
    { statusCode: 422 },
  );
  const next = await s.patch(
    o,
    "custom",
    {
      base_revision: 1,
      value: {
        customFields: [],
        customRecords: [{ legacy_note: "Keep source" }],
      },
    },
    "custom-remove",
  );
  assert.equal(next.data.customRecords[0].legacy_note, "Keep source");
});
test("section validation refuses invalid numeric/date values, unsupported sections and oversized or polluted input", async () => {
  const s = new FormRecordsService(new InMemoryLightTickRepository());
  for (const [section, value] of [
    ["secrets", {}],
    ["modules", []],
    ["checkins", {}],
    ["decisions", [{ ...decision, probability: 101 }]],
    ["decisions", [{ ...decision, date: "2026-02-30" }]],
    [
      "predictions",
      [{ date: "2026-11-08", statement: "Predict", probability: "NaN" }],
    ],
    ["habits", { "2026-11-08": { minutes: -1, note: "No" } }],
    ["todos", [{ date: "2026-11-08", title: "Task", done: "yes" }]],
    [
      "custom",
      {
        customFields: [{ key: "f-date", label: "Date", type: "date" }],
        customRecords: [{ "f-date": "2026-02-30" }],
      },
    ],
    ["reviews", [{ date: "2026-11-08", thought: "x".repeat(100001) }]],
  ] as const)
    await assert.rejects(
      s.patch(o, section, { base_revision: 0, value }, "section-invalid"),
      { statusCode: 422 },
    );
  assert.equal((await s.read(o)).revision, 0);
});
test("queued section requests freeze their original body before waiting for the owner gate", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new FormRecordsService(repo);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const held = repo.transaction(o, async () => {
    entered();
    await gate;
  });
  await started;
  const body = { base_revision: 0, value: [{ ...decision }] };
  const saving = s.patch(o, "decisions", body, "section-frozen");
  body.value[0].title = "Mutated outside";
  release();
  await held;
  assert.equal((await saving).data.decisions[0].title, decision.title);
  const receipt = await repo.getOperation(o, "section-frozen");
  assert.equal((receipt!.requestPayload as any).value[0].title, decision.title);
});

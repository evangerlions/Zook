import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { BehaviorService } from "../../src/modules/lighttick/behavior/behavior.service.ts";
const o = { appId: "lighttick" as const, userId: "behavior-owner" },
  clock = () => new Date("2026-11-15T08:00:00Z"),
  input = {
    base_version: 0,
    date: "2026-11-15",
    module_id: "general",
    concept: " 核实假设 ",
    scenario: "先核对事实",
    effectiveness: 0,
  };
test("behavior CAS, receipts, archived review, concept suggestions and rating uncertainty stay owner scoped", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new BehaviorService(repo, clock);
  const r = await s.save(o, "application-first", input, "behavior-save-001");
  assert.equal(r.concept, "核实假设");
  assert.deepEqual(await s.save(o, r.id, input, "behavior-save-001"), r);
  assert.equal((await s.list(o, {})).stats.effectiveness_avg, null);
  await s.save(
    o,
    "application-second",
    { ...input, effectiveness: 4 },
    "behavior-save-002",
  );
  const page = await s.list(o, { q: "核实" });
  assert.equal(page.total, 2);
  assert.equal(page.stats.rated_count, 1);
  assert.equal(page.stats.effectiveness_avg, 4);
  assert.equal((await s.concepts(o, {})).items[0].count, 2);
  assert.equal((await s.list({ ...o, userId: "other" }, {})).total, 0);
  await assert.rejects(s.get({ ...o, userId: "other" }, r.id), {
    statusCode: 404,
  });
  await assert.rejects(s.save(o, r.id, input, "behavior-stale-001"), {
    statusCode: 409,
  });
  await s.archive(
    o,
    r.id,
    { base_version: 1, archived: true },
    "behavior-archive-1",
  );
  assert.equal((await s.list(o, {})).total, 1);
  assert.equal((await s.get(o, r.id)).archived, true);
  await s.archive(
    o,
    r.id,
    { base_version: 2, archived: false },
    "behavior-restore-1",
  );
  assert.equal((await s.list(o, {})).total, 2);
  assert.equal((await s.receipt(o, "behavior-save-001")).version, 1);
  await assert.rejects(
    s.save(
      o,
      "application-invalid",
      { ...input, date: "2026-02-30" },
      "behavior-invalid-1",
    ),
    { statusCode: 422 },
  );
});
test("behavior receipt failure rolls back and invalid PostgreSQL text is rejected before saving", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new BehaviorService(repo, clock);
  const old = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("receipt failure");
  };
  await assert.rejects(
    s.save(o, "application-rollback", input, "rollback-behavior"),
  );
  assert.equal((await s.list(o, {})).total, 0);
  repo.saveOperation = old;
  await assert.rejects(
    s.save(
      o,
      "application-nul",
      { ...input, scenario: "bad\0text" },
      "nul-behavior-request",
    ),
    { statusCode: 422 },
  );
});
test("behavior rejects year zero before PostgreSQL date parameters are produced", async () => {
  const s = new BehaviorService(new InMemoryLightTickRepository(), clock);
  await assert.rejects(
    s.save(
      o,
      "application-year-zero",
      { ...input, date: "0000-01-01" },
      "behavior-year-zero",
    ),
    { statusCode: 422 },
  );
  await assert.rejects(
    s.list(o, { date_from: "0000-01-01", date_to: "0000-01-30" }),
    { statusCode: 422 },
  );
});
test("queued behavior writes freeze original request bodies before waiting for the owner gate", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new BehaviorService(repo, clock);
  let release!: () => void, ready!: () => void;
  const entered = new Promise<void>((r) => {
      ready = r;
    }),
    holding = repo.transaction(o, async () => {
      ready();
      await new Promise<void>((r) => {
        release = r;
      });
    });
  await entered;
  const request = { ...input, scenario: "original" },
    pending = s.save(
      o,
      "application-frozen",
      request,
      "frozen-behavior-request",
    );
  request.scenario = "changed while queued";
  release();
  await holding;
  const saved = await pending;
  assert.equal(saved.scenario, "original");
  assert.deepEqual(
    await s.save(
      o,
      saved.id,
      { ...input, scenario: "original" },
      "frozen-behavior-request",
    ),
    saved,
  );
  const op = await repo.getOperation(o, "behavior:frozen-behavior-request");
  assert.equal(op!.requestPayload.scenario, "original");
});

import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import { ResearchAIService } from "../../src/modules/lighttick/investments/research-ai/research-ai.service.ts";
import { ResearchAIRunner } from "../../src/modules/lighttick/investments/research-ai/research-ai.runner.ts";
import { exportResearch } from "../../src/modules/lighttick/investments/research/research.export.ts";
const o = { appId: "lighttick" as const, userId: "research-ai-synthetic" },
  id = "inv-ai-research-fixture";
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    research = new ResearchService(repo),
    s = new ResearchAIService(repo, new InMemoryJobQueue());
  const i = (
    await research.createInstrument(
      o,
      { code: "600000", market: "SSE", kind: "stock", name: "Synthetic" },
      "symbol-original",
    )
  ).instrument;
  const body = {
    base_revision: 0,
    instrument_id: i.id,
    account_id: null,
    title: "Synthetic research",
    horizon: "swing",
    evidence: [],
    market_sources: [],
    ...Object.fromEntries(researchFields.map((k) => [k, ""])),
  };
  await research.write(o, id, body, "research-original");
  return { repo, research, s, body };
}
const input = (kind = "analysis") => ({
  research_id: id,
  base_revision: 1,
  kind,
  consent: true,
  model_mode: "platform",
  model_revision: 0,
});
const result = () => ({
  provider: "synthetic",
  providerModel: "fixture",
  text: JSON.stringify({
    text: "Reviewed research draft",
    limitations: "No live quotes supplied",
    citations: ["research:" + id + ":1"],
  }),
});
test("all three kinds freeze data without account, produce reviewed artifacts and replay without duplicate work", async () => {
  const { repo, s } = await setup();
  for (const kind of ["analysis", "guide", "report"]) {
    const key = "create-" + kind + "-original",
      w = await s.create(o, input(kind), key);
    assert.equal((await repo.investments.accounts(o)).length, 0);
    await new ResearchAIRunner(s, { complete: async () => result() }).execute(
      o,
      w.id,
    );
    const done = await s.readWork(o, w.id);
    assert.equal(done.status, "succeeded");
    assert.equal(done.adopted_at, null);
    assert.equal((await repo.investments.research.get(o, id))?.revision, 1);
    const adopted = await s.mutate(
      o,
      w.id,
      "adopt",
      { base_revision: done.revision },
      "adopt-" + kind + "-original",
    );
    assert.ok(adopted.adopted_at);
    assert.deepEqual(
      await s.mutate(
        o,
        w.id,
        "adopt",
        { base_revision: done.revision },
        "adopt-" + kind + "-original",
      ),
      adopted,
    );
    assert.equal((await s.create(o, input(kind), key)).id, w.id);
  }
  assert.equal(((await exportResearch(repo, o)).ai_artifacts ?? []).length, 3);
});
test("cancel fences late success; source changes reject adoption; source/model invalidation is terminal", async () => {
  const { repo, s, research, body } = await setup();
  let start!: () => void, release!: () => void;
  const begun = new Promise<void>((r) => (start = r));
  const w = await s.create(o, input(), "create-original");
  const run = new ResearchAIRunner(s, {
    complete: async () => {
      start();
      await new Promise<void>((r) => (release = r));
      return result();
    },
  }).execute(o, w.id);
  await begun;
  const active = await s.readWork(o, w.id);
  await s.mutate(
    o,
    w.id,
    "cancel",
    { base_revision: active.revision },
    "cancel-original",
  );
  release();
  await run;
  assert.equal((await s.readWork(o, w.id)).status, "cancelled");
  const next = await s.create(o, input("report"), "create-report-original");
  await new ResearchAIRunner(s, { complete: async () => result() }).execute(
    o,
    next.id,
  );
  await research.write(
    o,
    id,
    { ...body, base_revision: 1, title: "New revision" },
    "research-change",
  );
  const done = await s.readWork(o, next.id);
  await assert.rejects(
    s.mutate(
      o,
      next.id,
      "adopt",
      { base_revision: done.revision },
      "adopt-stale-original",
    ),
    { statusCode: 409 },
  );
  assert.equal(((await exportResearch(repo, o)).ai_artifacts ?? []).length, 0);
  await assert.rejects(s.readWork({ ...o, userId: "other" }, w.id), {
    statusCode: 404,
  });
});
test("unknown citations and provider failures fail closed; original receipt crash rolls back task", async () => {
  const { repo, s } = await setup();
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("receipt crash");
  };
  await assert.rejects(s.create(o, input(), "create-crash-original"));
  assert.equal((await repo.researchAI.list(o)).length, 0);
  repo.saveOperation = save;
  for (const bad of ["provider", "citation", "truncated"]) {
    const w = await s.create(o, input(), "create-" + bad + "-original");
    await new ResearchAIRunner(s, {
      complete: async () => {
        if (bad === "provider") throw Error("private error");
        if (bad === "truncated") return { ...result(), finishReason: "length" };
        return {
          ...result(),
          text: JSON.stringify({
            text: "bad",
            citations: ["invented"],
            limitations: "unknown",
          }),
        };
      },
    }).execute(o, w.id);
    const done = await s.readWork(o, w.id);
    assert.equal(done.status, "failed");
    assert.equal(done.output, null);
  }
});
test("task pagination is replayable and invalidates after a mutation without deleting inputs", async () => {
  const { s } = await setup();
  for (const kind of ["analysis", "guide"]) {
    const w = await s.create(o, input(kind), "page-" + kind + "-original");
    await new ResearchAIRunner(s, { complete: async () => result() }).execute(
      o,
      w.id,
    );
  }
  const first = await s.listWorks(o, id, "", 1);
  assert.ok(first.next_cursor);
  const next = await s.listWorks(o, id, first.next_cursor!, 1);
  assert.notEqual(first.items[0].id, next.items[0].id);
  assert.deepEqual(await s.listWorks(o, id, first.next_cursor!, 1), next);
  await s.mutate(
    o,
    first.items[0].id,
    "adopt",
    { base_revision: first.items[0].revision },
    "page-adopt-original",
  );
  await assert.rejects(s.listWorks(o, id, first.next_cursor!, 1), {
    statusCode: 409,
  });
});

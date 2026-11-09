import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { MaterialService } from "../../src/modules/lighttick/investments/materials/material.service.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { ResearchAIService } from "../../src/modules/lighttick/investments/research-ai/research-ai.service.ts";
import { ResearchAIRunner } from "../../src/modules/lighttick/investments/research-ai/research-ai.runner.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";
test("research AI freezes exact material content; edits retain pins, archive fences adoption; authorized export retains all versions/receipts", async () => {
  const repo = new InMemoryLightTickRepository(),
    o = { appId: "lighttick" as const, userId: "materials-ai-synthetic" },
    s = new MaterialService(repo),
    r = new ResearchService(repo),
    a = new ResearchAIService(repo, new InMemoryJobQueue());
  const b = {
    base_revision: 0,
    title: "Source",
    content: "  original\r\n source  ",
    locator: "p1",
    source_url: null,
    available_at: "2026-10-01T00:00:00Z",
    contrary_evidence: "assumptions",
  };
  const m = await s.write(
      o,
      "inv-material-ai-fixture",
      b,
      "material-create-original",
    ),
    i = (
      await r.createInstrument(
        o,
        { market: "SSE", code: "600000", kind: "stock", name: "Synthetic" },
        "symbol-original",
      )
    ).instrument,
    rid = "inv-research-ai-fixture";
  await r.write(
    o,
    rid,
    {
      base_revision: 0,
      instrument_id: i.id,
      account_id: null,
      title: "Dossier",
      horizon: "short",
      evidence: [],
      market_sources: [],
      material_sources: [
        { id: m.id, version: 1, content_digest: m.content_digest },
      ],
      ...Object.fromEntries(researchFields.map((k) => [k, ""])),
    },
    "research-original",
  );
  const request = {
    research_id: rid,
    base_revision: 1,
    kind: "guide",
    consent: true,
    model_mode: "platform",
    model_revision: 0,
  };
  const w = await a.create(o, request, "work-original");
  assert.equal(w.input.materials![0].content, b.content);
  await s.write(
    o,
    m.id,
    { ...b, base_revision: 1, content: "New source" },
    "source-update-original",
  );
  let seen = false;
  await new ResearchAIRunner(a, {
    complete: async (input) => {
      assert.ok(input.messages.at(-1)!.content.includes("original"));
      seen = true;
      return {
        provider: "synthetic",
        providerModel: "fixture",
        text: JSON.stringify({
          text: "Guide",
          limitations: "Synthetic only",
          citations: ["material:" + m.id + ":1"],
        }),
      };
    },
  }).execute(o, w.id);
  assert.ok(seen);
  const done = await a.readWork(o, w.id);
  assert.equal(done.status, "succeeded");
  await a.mutate(
    o,
    w.id,
    "adopt",
    { base_revision: done.revision },
    "adopt-original",
  );
  const second = await a.create(o, request, "second-work-original");
  await new ResearchAIRunner(a, {
    complete: async () => ({
      provider: "synthetic",
      providerModel: "fixture",
      text: JSON.stringify({
        text: "Guide",
        limitations: "Synthetic",
        citations: ["material:" + m.id + ":1"],
      }),
    }),
  }).execute(o, second.id);
  await s.archive(o, m.id, { base_revision: 2 }, "archive-original", true);
  await assert.rejects(
    a.mutate(
      o,
      second.id,
      "adopt",
      { base_revision: 3 },
      "archive-adopt-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(a.create(o, request, "archived-work-original"), {
    statusCode: 409,
  });
  const exported = await exportInvestments(repo, o);
  assert.equal(exported.materials!.versions.length, 3);
  assert.equal(exported.materials!.receipts.length, 3);
  assert.equal(exported.materials!.versions.at(-1)!.content, b.content);
  assert.equal(
    exported.research.ai_artifacts![0].input.materials![0].revision,
    1,
  );
  assert.ok(!JSON.stringify(exported).includes("api_key"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
const owner = { appId: "lighttick" as const, userId: "synthetic-research" },
  id = "inv-synthetic-research";
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    s = new ResearchService(
      repo,
      async () => {},
      () => new Date("2026-11-05T08:00:00Z"),
    );
  const i = (
    await s.createInstrument(
      owner,
      { code: "600000", market: "SSE", kind: "stock", name: "Synthetic" },
      "symbol-original",
    )
  ).instrument;
  const body = {
    base_revision: 0,
    instrument_id: i.id,
    account_id: null,
    title: "Synthetic dossier",
    horizon: "swing",
    evidence: [
      {
        title: "Observation",
        content: "  original\r\ntext  ",
        locator: "page 3",
        source_url: null,
        available_at: "2026-10-30T16:00:00+08:00",
        contrary_evidence: "unknown",
      },
    ],
    market_sources: [],
    ...Object.fromEntries(researchFields.map((k) => [k, ""])),
  };
  return { repo, s, body };
}
test("research is independent of accounts, preserves exact evidence/version and original replay, CAS and archive history", async () => {
  const { repo, s, body } = await setup();
  const e = await s.write(owner, id, body, "research-original");
  assert.equal((await repo.investments.accounts(owner)).length, 0);
  assert.equal(e.evidence[0].content, body.evidence[0].content);
  await s.write(
    owner,
    id,
    { ...body, base_revision: 1, title: "Cloud" },
    "research-second",
  );
  assert.deepEqual(await s.write(owner, id, body, "research-original"), e);
  await assert.rejects(
    s.write(owner, id, { ...body, title: "changed" }, "research-original"),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.write(owner, id, { ...body, base_revision: 1 }, "research-conflict"),
    { statusCode: 409 },
  );
  assert.equal((await s.history(owner, id)).items.length, 2);
  await s.archive(owner, id, { base_revision: 2 }, "archive-original", true);
  assert.equal((await s.listEntries(owner, undefined)).items.length, 0);
  assert.equal(
    (await s.listEntries(owner, undefined, "", 20, true)).items.length,
    1,
  );
  await assert.rejects(
    s.write(owner, id, { ...body, base_revision: 3 }, "archived-edit"),
    { statusCode: 409 },
  );
  await s.archive(owner, id, { base_revision: 3 }, "restore-original", false);
  assert.equal((await s.history(owner, id)).items.length, 4);
});
test("research enforces owner, exact source and instrument identity; transaction receipt failure rolls back versions", async () => {
  const { repo, s, body } = await setup();
  await assert.rejects(
    s.write({ ...owner, userId: "other" }, id, body, "foreign-owner"),
    { statusCode: 404 },
  );
  await assert.rejects(
    s.write(
      owner,
      id,
      {
        ...body,
        market_sources: [
          {
            id: "inv-missing-source",
            version: 1,
            input_digest: "a".repeat(64),
          },
        ],
      },
      "missing-source",
    ),
    { statusCode: 404 },
  );
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("crash");
  };
  await assert.rejects(s.write(owner, id, body, "receipt-crash"));
  assert.equal(await repo.investments.research.get(owner, id), undefined);
  assert.equal(
    (await repo.investments.research.versions(owner, id, 999, 10)).length,
    0,
  );
  repo.saveOperation = save;
  await s.write(owner, id, body, "receipt-crash");
  await assert.rejects(s.readEntry({ ...owner, userId: "other" }, id), {
    statusCode: 404,
  });
  repo.investments.deleteOwner(owner);
  assert.equal((await repo.investments.research.list(owner)).length, 0);
});
test("research pages/history bind owner, filter and catalog revision, and invalid or oversized input fails explicitly", async () => {
  const { s, body } = await setup();
  await s.write(owner, id, body, "research-first");
  await s.write(owner, "inv-second-research", body, "research-second");
  const p = await s.listEntries(owner, undefined, "", 1);
  assert.ok(p.next_cursor);
  await assert.rejects(
    s.listEntries({ ...owner, userId: "other" }, undefined, p.next_cursor!),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.listEntries(owner, body.instrument_id, p.next_cursor!),
    { statusCode: 409 },
  );
  await s.write(
    owner,
    id,
    { ...body, base_revision: 1, title: "Update" },
    "research-update",
  );
  await assert.rejects(s.listEntries(owner, undefined, p.next_cursor!), {
    statusCode: 409,
  });
  const h = await s.history(owner, id, "", 1);
  assert.ok(h.next_cursor);
  await s.archive(owner, id, { base_revision: 2 }, "research-archive", true);
  await assert.rejects(s.history(owner, id, h.next_cursor!), {
    statusCode: 409,
  });
  await assert.rejects(
    s.write(
      owner,
      "inv-bad-research",
      {
        ...body,
        evidence: [{ ...body.evidence[0], source_url: "javascript:alert(1)" }],
      },
      "bad-source-url",
    ),
    { statusCode: 422 },
  );
});

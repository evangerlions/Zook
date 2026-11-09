import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { MaterialService } from "../../src/modules/lighttick/investments/materials/material.service.ts";
import { ResearchService } from "../../src/modules/lighttick/investments/research/research.service.ts";
import { researchFields } from "../../src/modules/lighttick/investments/research/research.types.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-materials" },
  mid = "inv-material-fixture";
const content = {
  title: "Source",
  content: "  original\r\nverbatim  ",
  locator: "page 3",
  source_url: "https://example.invalid/source",
  available_at: "2026-10-30T16:00:00+08:00",
  contrary_evidence: "uncertain",
};
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    s = new MaterialService(repo),
    r = new ResearchService(repo),
    i = (
      await r.createInstrument(
        o,
        { market: "SSE", code: "600000", kind: "stock", name: "Synthetic" },
        "symbol-original",
      )
    ).instrument;
  const m = await s.write(
    o,
    mid,
    { ...content, base_revision: 0 },
    "material-original",
  );
  const source = {
    id: m.id,
    version: m.revision,
    content_digest: m.content_digest,
  };
  const body = {
    base_revision: 0,
    instrument_id: i.id,
    account_id: null,
    title: "Synthetic dossier",
    horizon: "short",
    evidence: [],
    market_sources: [],
    material_sources: [source],
    ...Object.fromEntries(researchFields.map((k) => [k, ""])),
  };
  return { repo, s, r, m, body, source };
}
test("independent material identity and exact versions reused across research, old-client omission retains references", async () => {
  const { repo, s, r, m, body, source } = await setup();
  assert.equal((await repo.investments.accounts(o)).length, 0);
  assert.equal(m.content, content.content);
  for (const id of ["inv-research-first", "inv-research-second"])
    await r.write(o, id, body, "create-" + id);
  assert.equal((await s.references(o, mid)).items.length, 2);
  const next = await s.write(
    o,
    mid,
    { ...content, content: "new content", base_revision: 1 },
    "material-new-version",
  );
  assert.notEqual(next.content_digest, m.content_digest);
  assert.deepEqual(
    (await r.readEntry(o, "inv-research-first")).material_sources,
    [source],
  );
  assert.equal((await s.readMaterial(o, mid, 1)).content, content.content);
  const { material_sources, ...oldClient } = body;
  await r.write(
    o,
    "inv-research-first",
    { ...oldClient, base_revision: 1, title: "Old client save" },
    "old-client-original",
  );
  assert.deepEqual(
    (await r.readEntry(o, "inv-research-first")).material_sources,
    [source],
  );
  await r.write(
    o,
    "inv-research-first",
    {
      ...body,
      base_revision: 2,
      material_sources: [
        { id: mid, version: 2, content_digest: next.content_digest },
      ],
    },
    "explicit-source-upgrade",
  );
  assert.deepEqual(
    (await s.references(o, mid)).items.map((x) => x.material_version),
    [2, 1],
  );
});
test("archive preserves pinned sources/history, rejects new links, restores same identity, CAS and exact originals", async () => {
  const { s, r, m, body } = await setup();
  await r.write(o, "inv-research-first", body, "research-original");
  const archived = await s.archive(
    o,
    mid,
    { base_revision: 1 },
    "archive-original",
    true,
  );
  assert.equal(archived.id, m.id);
  assert.equal((await s.listMaterials(o)).items.length, 0);
  assert.equal((await s.listMaterials(o, "", 20, true)).items.length, 1);
  assert.deepEqual(
    await s.archive(o, mid, { base_revision: 1 }, "archive-original", true),
    archived,
  );
  await assert.rejects(
    s.archive(o, mid, { base_revision: 1 }, "archive-original", false),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.write(o, mid, { ...content, base_revision: 2 }, "edit-archived-original"),
    { statusCode: 409 },
  );
  await assert.rejects(
    r.write(o, "inv-research-second", body, "new-archived-link"),
    { statusCode: 409 },
  );
  await r.write(
    o,
    "inv-research-first",
    { ...body, base_revision: 1, title: "Retain old reference" },
    "retained-link-original",
  );
  assert.equal((await s.readMaterial(o, mid, 1)).content, m.content);
  const restored = await s.archive(
    o,
    mid,
    { base_revision: 2 },
    "restore-original",
    false,
  );
  assert.equal(restored.id, m.id);
  assert.equal(restored.revision, 3);
  await r.write(o, "inv-research-second", body, "after-restore-link");
  const history = await s.history(o, mid, "", 1);
  assert.equal(history.items[0].revision, 3);
  const second = await s.history(o, mid, history.next_cursor!, 1);
  assert.equal(second.items[0].revision, 2);
  assert.deepEqual(await s.history(o, mid, history.next_cursor!, 1), second);
  await assert.rejects(
    s.write(
      o,
      mid,
      { ...content, base_revision: 1 },
      "stale-material-original",
    ),
    { statusCode: 409 },
  );
  await s.write(
    o,
    mid,
    { ...content, base_revision: 3 },
    "new-material-original",
  );
  await assert.rejects(s.history(o, mid, history.next_cursor!, 1), {
    statusCode: 409,
  });
});
test("owner isolation, digest/version mismatch and rollback keep no orphan facts or original receipts", async () => {
  const { repo, s, r, body } = await setup();
  await assert.rejects(s.readMaterial({ ...o, userId: "other" }, mid), {
    statusCode: 404,
  });
  await assert.rejects(s.references({ ...o, userId: "other" }, mid), {
    statusCode: 404,
  });
  await assert.rejects(
    r.write(
      o,
      "inv-research-first",
      {
        ...body,
        material_sources: [
          { id: mid, version: 2, content_digest: "a".repeat(64) },
        ],
      },
      "bad-version-original",
    ),
    { statusCode: 404 },
  );
  await assert.rejects(
    r.write(
      o,
      "inv-research-first",
      {
        ...body,
        material_sources: [
          { id: mid, version: 1, content_digest: "a".repeat(64) },
        ],
      },
      "bad-digest-original",
    ),
    { statusCode: 404 },
  );
  await assert.rejects(
    s.write(
      o,
      "inv-future-source",
      { ...content, base_revision: 0, available_at: "2099-01-01T00:00:00Z" },
      "future-material-original",
    ),
    { statusCode: 422 },
  );
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("receipt crash");
  };
  await assert.rejects(
    s.write(
      o,
      mid,
      { ...content, base_revision: 1 },
      "crash-material-original",
    ),
  );
  assert.equal((await s.readMaterial(o, mid)).revision, 1);
  assert.equal((await s.history(o, mid)).items.length, 1);
  repo.saveOperation = save;
  assert.deepEqual(
    await s.write(
      o,
      mid,
      { ...content, base_revision: 0 },
      "material-original",
    ),
    await s.readMaterial(o, mid),
  );
  await repo.deleteOwnerData(o);
  assert.equal((await s.listMaterials(o, "", 20, true)).items.length, 0);
  await assert.rejects(s.readMaterial(o, mid, 1), { statusCode: 404 });
});
test("material catalog/history/reference cursors replay and invalidate on owner changes only", async () => {
  const { s, r, body } = await setup();
  await s.write(
    o,
    "inv-material-second",
    { ...content, title: "Second", base_revision: 0 },
    "second-material-original",
  );
  const first = await s.listMaterials(o, "", 1);
  assert.ok(first.next_cursor);
  const second = await s.listMaterials(o, first.next_cursor!, 1);
  assert.deepEqual(second, await s.listMaterials(o, first.next_cursor!, 1));
  await assert.rejects(
    s.listMaterials({ ...o, userId: "other" }, first.next_cursor!, 1),
    { statusCode: 409 },
  );
  await s.write(
    o,
    mid,
    { ...content, base_revision: 1, title: "Changed" },
    "changed-material-original",
  );
  await assert.rejects(s.listMaterials(o, first.next_cursor!, 1), {
    statusCode: 409,
  });
  for (const id of ["inv-research-first", "inv-research-second"])
    await r.write(o, id, body, "ref-" + id);
  const refs = await s.references(o, mid, "", 1);
  assert.ok(refs.next_cursor);
  const next = await s.references(o, mid, refs.next_cursor!, 1);
  assert.deepEqual(await s.references(o, mid, refs.next_cursor!, 1), next);
  await r.archive(
    o,
    "inv-research-first",
    { base_revision: 1 },
    "archive-research-original",
    true,
  );
  await assert.rejects(s.references(o, mid, refs.next_cursor!, 1), {
    statusCode: 409,
  });
  assert.equal((await s.references(o, mid)).items[0].archived, true);
});
test("optional legacy account/instrument scope and period end stay versioned, enforce owner and match pinned research context", async () => {
  const { repo, s, r, body } = await setup();
  const i = body.instrument_id;
  const a = await r.createAccount(
    o,
    "inv-material-account",
    {
      base_revision: 0,
      name: "Synthetic scope",
      currency: "CNY",
      baseline_date: "2026-10-01",
      opening_cash: "0",
      opening_positions: [],
    },
    "material-account-original",
  );
  const b = {
      ...content,
      base_revision: 0,
      instrument_id: i,
      account_id: a.id,
      period_end: "2026-09-30",
    },
    m = await s.write(o, "inv-scoped-material", b, "scoped-material-original"),
    ref = { id: m.id, version: 1, content_digest: m.content_digest };
  await assert.rejects(
    r.write(
      o,
      "inv-scope-research-wrong",
      { ...body, material_sources: [ref] },
      "scope-wrong-account",
    ),
    { statusCode: 422 },
  );
  const another = (
    await r.createInstrument(
      o,
      { market: "SSE", code: "600001", kind: "stock", name: "Other" },
      "other-symbol-original",
    )
  ).instrument;
  await assert.rejects(
    r.write(
      o,
      "inv-scope-research-wrong",
      {
        ...body,
        account_id: a.id,
        instrument_id: another.id,
        material_sources: [ref],
      },
      "scope-wrong-instrument",
    ),
    { statusCode: 422 },
  );
  await r.write(
    o,
    "inv-scope-research-right",
    { ...body, account_id: a.id, material_sources: [ref] },
    "scope-right-original",
  );
  const updated = await s.write(
    o,
    m.id,
    { ...content, base_revision: 1, content: "New scope content" },
    "scope-old-client-original",
  );
  assert.equal(updated.account_id, a.id);
  assert.equal(updated.instrument_id, i);
  assert.equal(updated.period_end, "2026-09-30");
  assert.notEqual(updated.content_digest, m.content_digest);
  await assert.rejects(
    s.write(
      o,
      "inv-invalid-scoped-material",
      { ...b, instrument_id: "inv-foreign-instrument" },
      "scope-foreign-original",
    ),
    { statusCode: 404 },
  );
  await assert.rejects(
    s.write(
      o,
      "inv-invalid-scoped-material",
      { ...b, period_end: "2026-02-30" },
      "scope-invalid-date",
    ),
    { statusCode: 422 },
  );
  await s.write(
    o,
    m.id,
    {
      ...content,
      base_revision: 2,
      instrument_id: null,
      account_id: null,
      period_end: null,
    },
    "scope-explicit-clear",
  );
  assert.equal((await s.readMaterial(o, m.id, 1)).period_end, "2026-09-30");
  await assert.rejects(
    r.write(
      o,
      "inv-old-scoped-reference",
      { ...body, material_sources: [ref] },
      "old-scoped-ref-original",
    ),
    { statusCode: 422 },
  );
  assert.equal(
    (await repo.investments.materials.version(o, m.id, 1))!.account_id,
    a.id,
  );
});

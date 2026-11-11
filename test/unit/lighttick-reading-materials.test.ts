import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
const o = { appId: "lighttick", userId: "materials-synthetic" } as const;
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    s = new ReadingService(repo);
  const row = await s.write(
    o,
    "article-materials",
    "import",
    {
      base_revision: 0,
      content: {
        title: "Reading",
        body: "First paragraph.\n\nSecond paragraph.",
        source_url: null,
        language: "en",
        published_at: null,
      },
    },
    "material-import-original",
  );
  return { repo, s, row };
}
test("manual draft and explicit adopted text remain separate, preserving previous adopted content and all history", async () => {
  const { s, row } = await setup();
  const body = {
    base_revision: 1,
    content_version: row.content_version,
    kind: "summary",
    paragraph_id: null,
    text: "  My first draft.\n",
  };
  let r = await s.write(o, row.id, "draft", body, "material-draft-first");
  assert.equal(r.materials![0].adopted, null);
  const { text: _, ...adoption } = body;
  r = await s.write(
    o,
    row.id,
    "adopt",
    { ...adoption, base_revision: 2, draft_version: 1 },
    "material-adopt-first",
  );
  assert.equal(r.materials![0].adopted!.text, body.text);
  r = await s.write(
    o,
    row.id,
    "draft",
    { ...body, base_revision: 3, text: "Unadopted revision." },
    "material-draft-second",
  );
  assert.equal(r.materials![0].draft.version, 2);
  assert.equal(r.materials![0].adopted!.version, 1);
  assert.equal(r.materials![0].adopted!.text, body.text);
  assert.equal((await s.history(o, row.id)).items.length, 4);
  assert.equal(
    (await s.export(o)).articles[0].materials![0].draft.text,
    "Unadopted revision.",
  );
  assert.deepEqual(
    await s.write(o, row.id, "draft", body, "material-draft-first"),
    (await s.history(o, row.id)).items.find((r) => r.revision === 2),
  );
});
test("paragraph provenance, kind, base version, adoption version and permissions are checked independently", async () => {
  const { s, row, repo } = await setup();
  const b = {
    base_revision: 1,
    content_version: row.content_version,
    kind: "translation",
    paragraph_id: "p-2",
    text: "第二段。",
  };
  await s.write(o, row.id, "draft", b, "material-translation-first");
  await assert.rejects(s.write(o, row.id, "draft", b, "material-stale-base"), {
    statusCode: 409,
  });
  for (const fields of [
    { paragraph_id: "p-3" },
    { paragraph_id: "__proto__" },
    { kind: "summary" },
    { content_version: "b".repeat(64) },
  ])
    await assert.rejects(
      s.write(
        o,
        row.id,
        "draft",
        { ...b, base_revision: 2, ...fields },
        "material-invalid-original",
      ),
    );
  await assert.rejects(
    s.write(
      o,
      row.id,
      "adopt",
      {
        base_revision: 2,
        content_version: row.content_version,
        kind: "translation",
        paragraph_id: "p-2",
        draft_version: 2,
      },
      "material-wrong-adoption",
    ),
    { statusCode: 409 },
  );
  const before = await s.read(o, row.id),
    save = repo.saveOperation;
  repo.saveOperation = async () => {
    throw Error("receipt failure");
  };
  await assert.rejects(
    s.write(
      o,
      row.id,
      "draft",
      { ...b, base_revision: 2, text: "must rollback" },
      "material-rollback-key",
    ),
    /receipt failure/,
  );
  repo.saveOperation = save;
  assert.deepEqual(await s.read(o, row.id), before);
  const denied = new ReadingService(repo, async () => {
    throw Error("revoked");
  });
  await assert.rejects(
    denied.write(o, row.id, "draft", b, "material-translation-first"),
    /revoked/,
  );
});
test("guide and English drafts are independent and archived source rejects new edits", async () => {
  const { s, row } = await setup();
  let current = row;
  for (const kind of ["guide", "english"]) {
    const b = {
      base_revision: current.revision,
      content_version: row.content_version,
      kind,
      paragraph_id: null,
      text: "Draft: " + kind,
    };
    current = await s.write(o, row.id, "draft", b, "material-extra-" + kind);
    current = await s.write(
      o,
      row.id,
      "adopt",
      {
        base_revision: current.revision,
        content_version: row.content_version,
        kind,
        paragraph_id: null,
        draft_version: 1,
      },
      "material-adopt-" + kind,
    );
  }
  assert.deepEqual(
    current.materials!.map((m) => [m.kind, m.adopted!.text]),
    [
      ["guide", "Draft: guide"],
      ["english", "Draft: english"],
    ],
  );
  current = await s.write(
    o,
    row.id,
    "archive",
    { base_revision: current.revision },
    "material-archive-original",
  );
  await assert.rejects(
    s.write(
      o,
      row.id,
      "draft",
      {
        base_revision: current.revision,
        content_version: row.content_version,
        kind: "guide",
        paragraph_id: null,
        text: "blocked",
      },
      "material-archived-draft",
    ),
    { statusCode: 409 },
  );
  assert.equal((await s.export(o)).articles[0].materials!.length, 2);
});
test("aggregate UTF-8 material limit rejects atomically without replacing adopted facts", async () => {
  const { s, row, repo } = await setup();
  let current = row;
  for (const kind of ["guide", "english", "summary"]) {
    const b = {
      content_version: row.content_version,
      kind,
      paragraph_id: null,
    };
    current = await s.write(
      o,
      row.id,
      "draft",
      { ...b, base_revision: current.revision, text: "读".repeat(100000) },
      "large-material-" + kind,
    );
    current = await s.write(
      o,
      row.id,
      "adopt",
      { ...b, base_revision: current.revision, draft_version: 1 },
      "large-adopt-" + kind,
    );
  }
  await assert.rejects(
    s.write(
      o,
      row.id,
      "draft",
      {
        base_revision: current.revision,
        content_version: row.content_version,
        kind: "translation",
        paragraph_id: "p-1",
        text: "读".repeat(100000),
      },
      "large-material-rejected",
    ),
    { statusCode: 413 },
  );
  assert.equal((await s.read(o, row.id)).revision, current.revision);
  assert.equal(
    await repo.getOperation(o, "large-material-rejected"),
    undefined,
  );
});

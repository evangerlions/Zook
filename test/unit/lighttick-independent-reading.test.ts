import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { restrictedRequest } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
const owner = { appId: "lighttick", userId: "reading-owner" } as const;
const other = { appId: "lighttick", userId: "reading-other" } as const;
const id = "article-synthetic-1";
const body = {
  base_revision: 0,
  content: {
    title: "原文",
    body: "  原文\n第二行  ",
    source_url: null,
    language: "zh",
    published_at: null,
  },
};
const setup = () => {
  const repo = new InMemoryLightTickRepository();
  return { repo, s: new ReadingService(repo) };
};
test("pasted import keeps exact bytes, unknown date, immutable digest and original replay", async () => {
  const { s } = setup();
  const row = await s.write(
    owner,
    id,
    "import",
    body,
    "reading-import-original",
  );
  assert.equal(row.content.body, body.content.body);
  assert.equal(row.content.published_at, null);
  assert.match(row.content_version, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    await s.write(owner, id, "import", body, "reading-import-original"),
    row,
  );
  assert.equal((await s.list(owner)).items.length, 1);
  await assert.rejects(
    s.write(
      owner,
      id,
      "import",
      { ...body, content: { ...body.content, title: "changed" } },
      "reading-import-original",
    ),
    { statusCode: 409 },
  );
  assert.equal((await s.list(other)).items.length, 0);
  await assert.rejects(s.read(other, id), { statusCode: 404 });
  await assert.rejects(s.receipt(other, "reading-import-original"), {
    statusCode: 404,
  });
});
test("notes, per-device positions and explicit read are separate; stale writes preserve current facts", async () => {
  const { s } = setup();
  let row = await s.write(owner, id, "import", body, "reading-import-original");
  row = await s.write(
    owner,
    id,
    "position",
    {
      base_revision: 1,
      content_version: row.content_version,
      device_id: "device-one",
      position: 8,
    },
    "reading-position-one",
  );
  assert.equal(row.personal.read, false);
  assert.equal(row.personal.notes, "");
  row = await s.write(
    owner,
    id,
    "position",
    {
      base_revision: 2,
      content_version: row.content_version,
      device_id: "device-two",
      position: 1,
    },
    "reading-position-two",
  );
  assert.deepEqual(row.personal.positions, {
    "device-one": 8,
    "device-two": 1,
  });
  const personal = {
    notes: "  私人笔记\n",
    feedback: "待应用",
    bookmark: true,
    later: false,
    read: true,
  };
  row = await s.write(
    owner,
    id,
    "personal",
    { base_revision: 3, content_version: row.content_version, personal },
    "reading-notes-original",
  );
  assert.equal(row.personal.notes, personal.notes);
  assert.ok(row.personal.read_at);
  assert.equal(
    row.content_version,
    (await s.history(owner, id)).items.at(-1)!.content_version,
  );
  await assert.rejects(
    s.write(
      owner,
      id,
      "personal",
      {
        base_revision: 3,
        content_version: row.content_version,
        personal: { ...personal, notes: "old" },
      },
      "reading-notes-conflict",
    ),
    { statusCode: 409 },
  );
  assert.equal((await s.read(owner, id)).personal.notes, personal.notes);
});
test("archive is reversible, keeps history and receipts but rejects private writes", async () => {
  const { s } = setup();
  const row = await s.write(
    owner,
    id,
    "import",
    body,
    "reading-import-original",
  );
  await s.write(
    owner,
    id,
    "archive",
    { base_revision: 1 },
    "reading-archive-original",
  );
  assert.equal((await s.list(owner)).items.length, 0);
  assert.equal((await s.list(owner, { filter: "archived" })).items.length, 1);
  await assert.rejects(
    s.write(
      owner,
      id,
      "position",
      {
        base_revision: 2,
        content_version: row.content_version,
        device_id: "device-one",
        position: 0,
      },
      "reading-position-fail",
    ),
    { statusCode: 409 },
  );
  await s.write(
    owner,
    id,
    "restore",
    { base_revision: 2 },
    "reading-restore-original",
  );
  assert.deepEqual(
    (await s.history(owner, id)).items.map((r) => r.revision),
    [3, 2, 1],
  );
  assert.equal((await s.export(owner)).history.length, 3);
});
test("transaction failure rolls back article, history and receipt", async () => {
  const { repo, s } = setup();
  const save = repo.saveOperation;
  repo.saveOperation = async () => {
    throw Error("receipt failure");
  };
  await assert.rejects(
    s.write(owner, id, "import", body, "reading-import-original"),
    /receipt failure/,
  );
  assert.equal((await s.list(owner)).items.length, 0);
  repo.saveOperation = save;
  assert.equal(
    (await s.write(owner, id, "import", body, "reading-import-original"))
      .revision,
    1,
  );
});
test("receipt replay and history recheck authorization and owner deletion removes all reading state", async () => {
  const { repo } = setup();
  let allowed = true;
  const s = new ReadingService(repo, async () => {
    if (!allowed) throw Error("revoked");
  });
  await s.write(owner, id, "import", body, "reading-import-original");
  allowed = false;
  await assert.rejects(s.receipt(owner, "reading-import-original"), /revoked/);
  await assert.rejects(
    s.write(owner, id, "import", body, "reading-import-original"),
    /revoked/,
  );
  allowed = true;
  await repo.deleteOwnerData(owner);
  assert.equal((await s.list(owner)).items.length, 0);
  await assert.rejects(s.receipt(owner, "reading-import-original"), {
    statusCode: 404,
  });
});
test("request is frozen before lock wait; pagination and literal search are bounded", async () => {
  const { repo, s } = setup();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  const hold = repo.transaction(owner, async () => {
    entered();
    await gate;
  });
  await ready;
  const b = structuredClone(body);
  const pending = s.write(owner, id, "import", b, "reading-import-original");
  b.content.body = "changed after intent";
  release();
  await hold;
  assert.equal((await pending).content.body, body.content.body);
  for (let i = 2; i < 5; i++)
    await s.write(
      owner,
      "article-synthetic-" + i,
      "import",
      { ...body, content: { ...body.content, title: "literal % _ " + i } },
      "reading-import-" + i,
    );
  const first = await s.list(owner, { limit: "2" });
  const second = await s.list(owner, {
    limit: "2",
    cursor: first.next_cursor!,
  });
  assert.equal(first.items.length + second.items.length, 4);
  assert.equal(second.next_cursor, null);
  assert.equal((await s.list(owner, { search: "% _" })).items.length, 3);
  await assert.rejects(s.list(owner, { limit: "0" }), { statusCode: 422 });
});
test("validation rejects invalid dates, credentials in source URLs and unsafe device keys", async () => {
  const { s } = setup();
  for (const content of [
    { ...body.content, published_at: "2026-02-30T00:00:00Z" },
    { ...body.content, source_url: "https://user:secret@example.test" },
    { ...body.content, body: "" },
  ])
    await assert.rejects(
      s.write(
        owner,
        id,
        "import",
        { ...body, content },
        "reading-invalid-body",
      ),
      { statusCode: 422 },
    );
  const row = await s.write(
    owner,
    id,
    "import",
    body,
    "reading-import-original",
  );
  await assert.rejects(
    s.write(
      owner,
      id,
      "position",
      {
        base_revision: 1,
        content_version: row.content_version,
        device_id: "__proto__",
        position: 0,
      },
      "reading-unsafe-device",
    ),
    { statusCode: 422 },
  );
});
test("core scope rejects new reading writes while read/receipt lookups remain available", () => {
  assert.equal(
    restrictedRequest({
      method: "PUT",
      path: "/api/v1/lighttick/reading/articles/" + id,
    }),
    true,
  );
  assert.equal(
    restrictedRequest({
      method: "GET",
      path: "/api/v1/lighttick/reading/library",
    }),
    false,
  );
});

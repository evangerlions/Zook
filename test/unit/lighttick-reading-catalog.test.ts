import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { handleIndependentReadingRequest as handleReadingRequest } from "../../src/app/lighttick-independent-reading-routes.ts";
const owner = { appId: "lighttick", userId: "reading-catalog-owner" } as const;
const other = { ...owner, userId: "reading-catalog-other" };
test("catalog searches full private facts while transferring a bounded separate projection; old full library and immutable version remain intact", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new ReadingService(repo);
  const content = {
    title: "目录合成文章",
    body: "🙂".repeat(160) + "hidden original evidence".repeat(10000),
    source_url: null,
    language: "en",
    published_at: null,
  };
  const row = await service.write(
    owner,
    "article-catalog-one",
    "import",
    { base_revision: 0, content },
    "catalog-import-original",
  );
  await service.write(
    owner,
    row.id,
    "personal",
    {
      base_revision: 1,
      content_version: row.content_version,
      personal: {
        notes: "private search needle",
        feedback: "review-only feedback",
        bookmark: true,
        later: false,
        read: false,
      },
    },
    "catalog-private-original",
  );
  const first = await service.catalog(owner, {
    search: "private search needle",
    filter: "feedback",
    limit: "1",
  });
  assert.equal(first.items.length, 1);
  assert.equal(first.next_cursor, null);
  assert.equal(first.items[0].preview, "🙂".repeat(160));
  assert.equal(first.items[0].content_version, row.content_version);
  assert.equal(first.items[0].has_feedback, true);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 2000);
  assert.ok(!JSON.stringify(first).includes("private search needle"));
  assert.ok(!Object.hasOwn(first.items[0], "content"));
  assert.ok(!Object.hasOwn(first.items[0], "personal"));
  assert.equal(
    (await service.catalog(owner, { search: "hidden original evidence" })).items
      .length,
    1,
  );
  assert.equal((await service.catalog(other)).items.length, 0);
  assert.deepEqual((await service.list(owner)).items[0].content, row.content);
  assert.equal((await service.read(owner, row.id)).content.body, content.body);
  assert.deepEqual(
    await service.receipt(owner, "catalog-import-original"),
    row,
  );
  await service.write(
    owner,
    "article-catalog-two",
    "import",
    {
      base_revision: 0,
      content: { ...content, title: "Second", body: "second" },
    },
    "catalog-import-second",
  );
  const page = await service.catalog(owner, { limit: "1" });
  const next = await service.catalog(owner, {
    limit: "1",
    cursor: page.next_cursor!,
  });
  assert.notEqual(page.items[0].id, next.items[0].id);
  assert.equal(next.next_cursor, null);
  await service.write(
    owner,
    row.id,
    "archive",
    { base_revision: 2 },
    "catalog-archive-original",
  );
  assert.equal(
    (await service.catalog(owner, { filter: "archived" })).items[0].id,
    row.id,
  );
  assert.equal((await service.catalog(owner)).items.length, 1);
});
test("catalog HTTP entry rechecks owner authority and validates filters without requiring worker/model availability", async () => {
  const repo = new InMemoryLightTickRepository();
  let checks = 0;
  const request = {
    method: "GET",
    path: "/api/v1/lighttick/reading/catalog",
    headers: {},
    query: {},
  } as const;
  assert.deepEqual(
    await handleReadingRequest(repo, owner, request, async () => {
      checks++;
    }),
    { items: [], next_cursor: null },
  );
  assert.equal(checks, 1);
  await assert.rejects(
    handleReadingRequest(
      repo,
      owner,
      { ...request, query: { filter: "invalid" } },
      async () => {},
    ),
    { statusCode: 422 },
  );
  await assert.rejects(
    handleReadingRequest(repo, owner, request, async () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
});

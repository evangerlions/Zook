import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
import { ReviewService } from "../../src/modules/lighttick/knowledge/review.service.ts";
const owner = { appId: "lighttick", userId: "reading-source-owner" } as const,
  other = { ...owner, userId: "reading-source-other" };
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    reading = new ReadingService(repo),
    row = await reading.write(
      owner,
      "article-source-original",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Independent original",
          body: "original prefix ".repeat(20000) + "full tail evidence",
          language: "en",
          source_url: "https://reading.example.test/original",
          published_at: null,
        },
      },
      "source-original-import",
    );
  return {
    repo,
    reading,
    row,
    actions: new ActionService(
      repo,
      () => new Date("2026-11-12T02:00:00Z"),
      undefined,
      true,
    ),
    review: new ReviewService(repo),
    knowledge: new KnowledgeService(repo),
  };
}
test("article practices and knowledge freeze an owner content SHA, keep completion independent and resolve archived originals without replacing missing versions", async () => {
  const f = await setup(),
    command = {
      key: "article-source-practice-original",
      source_kind: "article",
      source_id: f.row.id,
      source_version: f.row.content_version,
      title: "Apply one claim",
      date: null,
    };
  const { plan } = (await f.actions.request(
    owner,
    "POST",
    "/practices",
    command,
  )) as any;
  assert.equal(plan.practice_source.kind, "article");
  assert.equal((await f.reading.read(owner, f.row.id)).personal.read, false);
  assert.deepEqual(
    await f.actions.request(owner, "POST", "/practices", command),
    { plan },
  );
  await f.reading.write(
    owner,
    f.row.id,
    "personal",
    {
      base_revision: 1,
      content_version: f.row.content_version,
      personal: {
        notes: "",
        feedback: "",
        read: true,
        later: false,
        bookmark: false,
      },
    },
    "source-read-independent",
  );
  assert.notEqual(
    (await f.repo.getActionWorkspace(owner))!.data.plans.find(
      (p) => p.id === plan.id,
    )!.status,
    "done",
  );
  const source = (await f.actions.request(
    owner,
    "GET",
    "/practices/" + plan.id + "/source",
  )) as any;
  assert.equal(source.text, f.row.content.body);
  assert.equal(source.source_version, f.row.content_version);
  await assert.rejects(
    f.actions.request(other, "POST", "/practices", {
      ...command,
      key: "article-source-other-practice",
    }),
    { statusCode: 404 },
  );
  await assert.rejects(
    f.actions.request(owner, "POST", "/practices", {
      ...command,
      key: "article-source-wrong-version",
      source_version: "b".repeat(64),
    }),
    { statusCode: 409 },
  );
  const entry = await f.knowledge.mutate(
    owner,
    "knowledge-article-source",
    "save",
    {
      base_revision: 0,
      kind: "knowledge",
      title: "My interpretation",
      body: "Separate reasoning",
      tags: [],
      sources: [
        { kind: "article", id: f.row.id, version: f.row.content_version },
      ],
    },
    "knowledge-article-original",
  );
  assert.equal(
    (await f.knowledge.read(owner, entry.id)).body,
    "Separate reasoning",
  );
  await f.reading.write(
    owner,
    f.row.id,
    "archive",
    { base_revision: 2 },
    "article-source-archive",
  );
  assert.equal(
    (
      (await f.actions.request(
        owner,
        "GET",
        "/practices/" + plan.id + "/source",
      )) as any
    ).text,
    f.row.content.body,
  );
  assert.equal(
    (
      await f.review.source(owner, {
        kind: "article",
        id: f.row.id,
        version: f.row.content_version,
      })
    ).text,
    f.row.content.body,
  );
  await assert.rejects(
    f.actions.request(owner, "POST", "/practices", {
      ...command,
      key: "article-new-after-archive",
    }),
    { statusCode: 404 },
  );
  assert.equal((await f.knowledge.read(owner, entry.id)).id, entry.id);
});
test("global article search finds full-tail and private/material facts with bounded context, while explicit read is a separate fact and revisions expire cursors", async () => {
  const f = await setup();
  let result = await f.review.snapshot(owner, { q: "full tail evidence" });
  assert.equal(result.counts.article_saved, 1);
  assert.ok(result.items[0].excerpt.includes("full tail evidence"));
  assert.equal(result.counts.article_read, 0);
  const row = await f.reading.write(
    owner,
    f.row.id,
    "personal",
    {
      base_revision: 1,
      content_version: f.row.content_version,
      personal: {
        notes: "private thinking needle",
        feedback: "",
        read: true,
        bookmark: false,
        later: false,
      },
    },
    "article-source-private",
  );
  result = await f.review.snapshot(owner, {
    q: "private thinking needle",
    limit: "1",
  });
  assert.equal(result.counts.article_saved, 1);
  assert.equal(result.counts.article_read, 1);
  assert.equal(result.counts.lesson_completed, 0);
  assert.equal(result.counts.action_completed, 0);
  assert.ok(result.items[0].excerpt.includes("private thinking needle"));
  const cursor = result.next_cursor!;
  assert.ok(cursor);
  await f.reading.write(
    owner,
    row.id,
    "draft",
    {
      base_revision: 2,
      content_version: row.content_version,
      kind: "summary",
      paragraph_id: null,
      text: "draft-only material search needle",
    },
    "article-source-draft",
  );
  await assert.rejects(
    f.review.snapshot(owner, {
      q: "private thinking needle",
      limit: "1",
      cursor,
    }),
    { statusCode: 409 },
  );
  assert.equal(
    (await f.review.snapshot(owner, { q: "draft-only material search needle" }))
      .counts.article_saved,
    1,
  );
  assert.equal(
    (await f.review.snapshot(other, { q: "private thinking needle" })).total,
    0,
  );
  assert.equal(
    (
      await f.review.snapshot(owner, {
        q: "https://reading.example.test/original",
      })
    ).counts.article_saved,
    1,
  );
});

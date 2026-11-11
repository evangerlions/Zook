import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { parseReadingDocument } from "../../src/modules/lighttick/reading/reading-parser.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
const o = { appId: "lighttick" as const, userId: "reading-editions-owner" };
const content = {
  title: "原文标题".repeat(60),
  translated_title: "对应译名",
  body: "Original feed excerpt",
  source_url: "https://example.com/article",
  language: "en",
  published_at: null,
  published_date: "2016-12-14",
  author: "Original author",
  publisher: "Original publication",
  description: "Original summary",
  topics: ["认知", "心理"],
  category: "classic",
  access: "仅核对订阅摘要，未核对全文",
  recommendation_reason: "原推荐理由",
  tags: ["Original tag"],
};
const fields = {
  value: "insightful",
  difficulty: "right",
  takeaway: "  收获唯一词  ",
  question: "问题唯一词",
  action: "应用唯一词",
  tags: ["  反馈标签  ", "反馈标签"],
};
test("structured feedback preserves every legacy field, independent revision, original receipts and explicit read semantics", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new ReadingService(repo);
  let row = await s.write(
    o,
    "article-feedback",
    "import",
    { base_revision: 0, content },
    "feedback-import-original",
  );
  assert.equal(row.content.title, content.title);
  assert.equal(row.content.published_at, null);
  assert.equal(row.content.published_date, "2016-12-14");
  const request = {
    base_revision: 1,
    content_version: row.content_version,
    base_feedback_revision: 0,
    feedback: fields,
    mark_read: false,
  };
  const saved = await s.write(
    o,
    row.id,
    "feedback",
    request,
    "feedback-save-original",
  );
  assert.equal(saved.personal.structured_feedback!.takeaway, "收获唯一词");
  assert.deepEqual(saved.personal.structured_feedback!.tags, ["反馈标签"]);
  assert.equal(saved.personal.read, false);
  row = await s.write(
    o,
    row.id,
    "personal",
    {
      base_revision: 2,
      content_version: row.content_version,
      personal: {
        notes: "Independent notes",
        feedback: "Independent free text",
        bookmark: true,
        later: false,
        read: false,
      },
    },
    "feedback-private-original",
  );
  assert.equal(row.personal.structured_feedback!.version, 1);
  assert.deepEqual(
    await s.write(o, row.id, "feedback", request, "feedback-save-original"),
    saved,
  );
  await assert.rejects(
    s.write(
      o,
      row.id,
      "feedback",
      { ...request, base_revision: 3 },
      "feedback-stale-component",
    ),
    { statusCode: 409 },
  );
  row = await s.write(
    o,
    row.id,
    "feedback",
    {
      ...request,
      base_revision: 3,
      base_feedback_revision: 1,
      mark_read: true,
    },
    "feedback-mark-read",
  );
  assert.equal(row.personal.read, true);
  assert.ok(row.personal.read_at);
  assert.equal(row.personal.notes, "Independent notes");
  assert.equal(row.personal.feedback, "Independent free text");
  assert.equal(row.personal.structured_feedback!.version, 2);
  assert.equal((await s.history(o, row.id)).items.length, 4);
  assert.equal((await s.list(o, { filter: "feedback" })).items.length, 1);
  for (const search of [
    "对应译名",
    "Original publication",
    "原推荐理由",
    "收获唯一词",
    "问题唯一词",
    "应用唯一词",
    "反馈标签",
  ]) {
    assert.equal((await s.list(o, { search })).items.length, 1, search);
    assert.equal(
      (await s.list({ ...o, userId: "other" }, { search })).items.length,
      0,
    );
  }
  await assert.rejects(
    s.write(
      o,
      row.id,
      "feedback",
      {
        ...request,
        base_revision: 4,
        base_feedback_revision: 2,
        feedback: { ...fields, tags: Array(9).fill("x") },
      },
      "feedback-too-many-tags",
    ),
    { statusCode: 422 },
  );
  assert.equal((await s.read(o, row.id)).revision, 4);
  const oldHash = digest({
    title: "Old",
    body: "Exact original",
    source_url: null,
    language: "unknown",
    published_at: null,
    author: null,
    tags: [],
  });
  const old = await s.write(
    o,
    "article-old-hash",
    "import",
    {
      base_revision: 0,
      content: {
        title: "Old",
        body: "Exact original",
        source_url: null,
        language: "unknown",
        published_at: null,
      },
    },
    "old-hash-import",
  );
  assert.equal(
    old.content_version,
    oldHash,
    "new optional metadata cannot rewrite existing content hash meaning",
  );
});
test("full-text supplement creates a related immutable edition with original metadata; old notes, materials, positions and receipts remain", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new ReadingService(repo),
    work = new ReadingWorkService(repo, new InMemoryJobQueue());
  let row = await s.write(
    o,
    "article-edition-root",
    "import",
    { base_revision: 0, content },
    "edition-import-original",
  );
  row = await s.write(
    o,
    row.id,
    "personal",
    {
      base_revision: 1,
      content_version: row.content_version,
      personal: {
        notes: "Anchored old notes",
        feedback: "",
        bookmark: false,
        later: true,
        read: true,
      },
    },
    "edition-private-original",
  );
  row = await s.write(
    o,
    row.id,
    "position",
    {
      base_revision: 2,
      content_version: row.content_version,
      device_id: "phone-original",
      position: 5,
    },
    "edition-position-original",
  );
  const parent = structuredClone(row),
    created = await work.create(
      o,
      {
        kind: "fetch_full",
        article_id: row.id,
        content_version: row.content_version,
      },
      "full-text-original",
    );
  let calls = 0;
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        calls++;
        throw Error("Full text fetch cannot invoke a model");
      },
    } as any,
    async () => ({
      body: "<p>First complete paragraph.</p><p>Second complete paragraph.</p>".repeat(3),
      content_type: "text/html",
    }),
  );
  await runner.execute(o, created.id);
  const done = await work.read(o, created.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.output!.document!.capture_kind, "full_fetch");
  assert.equal(calls, 0);
  const adopted = await work.adopt(
      o,
      done.id,
      {
        base_revision: done.revision,
        output_digest: done.output_digest,
        index: 0,
        base_article_revision: null,
      },
      "full-text-adopt-original",
    ),
    edition = await s.read(o, adopted.article_id);
  assert.notEqual(edition.id, parent.id);
  assert.equal(edition.content.publisher, parent.content.publisher);
  assert.equal(edition.content.published_date, parent.content.published_date);
  assert.equal(edition.content.published_at, null);
  assert.equal(edition.provenance!.parent_article_id, parent.id);
  assert.equal(edition.provenance!.root_article_id, parent.id);
  assert.equal(edition.provenance!.kind, "full_fetch");
  assert.equal(edition.personal.notes, "");
  assert.equal(edition.personal.read, false);
  assert.deepEqual(await s.read(o, parent.id), parent);
  assert.equal((await s.editions(o, edition.id)).items.length, 2);
  const exported = await s.export(o);
  assert.equal(exported.articles.length, 2);
  assert.equal(
    exported.work[0].input.source_metadata!.publisher,
    "Original publication",
  );
  assert.equal(
    (await s.list(o, { search: "complete paragraph" })).items.length,
    1,
  );
});
test("source parsing is isolated from the API event loop, bounded and terminates on cancellation", async () => {
  const work = {
    kind: "collect_url" as const,
    input: {
      url: "https://example.com",
      title: "Selected",
      format: "article" as const,
    },
  };
  let responsive = false;
  const tick = setTimeout(() => {
    responsive = true;
  }, 0);
  const result = await parseReadingDocument(
    work,
    {
      body: "<p>Safe &amp; retained text</p><script>hidden()</script>",
      content_type: "text/html",
    },
    AbortSignal.timeout(5000),
  );
  clearTimeout(tick);
  assert.equal(responsive, true);
  assert.equal(result.entries![0].body, "Safe & retained text");
  assert.ok(result.document!.body.includes("hidden()"));
  const controller = new AbortController(),
    pending = parseReadingDocument(
      work,
      { body: "<div>".repeat(39000), content_type: "text/html" },
      controller.signal,
    );
  controller.abort(Error("cancel parser"));
  await assert.rejects(pending, /cancel parser/);
  await assert.rejects(
    parseReadingDocument(
      work,
      { body: "<div/>".repeat(40001), content_type: "text/html" },
      AbortSignal.timeout(5000),
    ),
    { statusCode: 413 },
  );
});

test("date-only feed dates retain their precision without inventing an instant", async () => {
  const result = await parseReadingDocument(
    {
      kind: "collect_source",
      input: { url: "https://example.com/feed", format: "rss" },
    },
    {
      body: "<rss><channel><title>Journal</title><item><title>Date only</title><link>https://example.com/date</link><description>Exact excerpt</description><pubDate>2016-12-14</pubDate></item></channel></rss>",
      content_type: "application/rss+xml",
    },
    AbortSignal.timeout(5000),
  );
  assert.equal(result.entries![0].published_at, null);
  assert.equal(result.entries![0].published_date, "2016-12-14");
  assert.equal(result.entries![0].publisher, "Journal");
});

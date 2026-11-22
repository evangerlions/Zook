import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { collectReadingDocument } from "../../src/modules/lighttick/independent-reading/reading-collection.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import { exportReview } from "../../src/modules/lighttick/knowledge/review.export.ts";
const o = { appId: "lighttick" as const, userId: "reading-work-owner" };
const request = {
  kind: "collect_url",
  url: "https://example.com/source",
  title: "Selected article",
};
function setup(complete?: any) {
  let now = new Date("2026-11-11T12:00:00Z"),
    calls = 0,
    allowed = true;
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  const work = new ReadingWorkService(
    repo,
    queue,
    async () => {
      if (!allowed) throw Object.assign(Error("revoked"), { statusCode: 403 });
    },
    () => now,
  );
  const llm = {
    complete:
      complete ??
      (async () => {
        calls++;
        return {
          text: "AI synthetic output",
          provider: "synthetic",
          providerModel: "fixture",
        };
      }),
  } as any;
  const runner = new ReadingWorkRunner(
    work,
    llm,
    async () => ({
      body: "<p>Original first paragraph</p><p>Second original paragraph</p>",
      content_type: "text/html",
    }),
    async () => {
      if (!allowed) throw Error("revoked");
    },
  );
  return {
    repo,
    queue,
    work,
    runner,
    llm,
    calls: () => calls,
    revoke: () => {
      allowed = false;
    },
    advance: () => {
      now = new Date(now.getTime() + 60000);
    },
  };
}
const source = {
  base_revision: 0,
  title: "RSS source",
  url: "https://example.com/feed",
  format: "rss",
  archived: false,
};
test("reading sources retain owner, immutable versions, CAS and original receipts without starting collection", async () => {
  const f = setup(),
    row = await f.work.saveSource(
      o,
      "source-test",
      source,
      "source-original-key",
    );
  await f.work.saveSource(
    o,
    row.id,
    { ...source, base_revision: 1, title: "Changed" },
    "source-edit-key",
  );
  assert.deepEqual(
    await f.work.saveSource(o, row.id, source, "source-original-key"),
    row,
  );
  assert.equal((await f.work.sourceHistory(o, row.id)).items.length, 2);
  assert.equal(f.queue.jobs.length, 0);
  await assert.rejects(f.work.source({ ...o, userId: "other" }, row.id), {
    statusCode: 404,
  });
  await assert.rejects(
    f.work.saveSource(
      o,
      row.id,
      { ...source, base_revision: 1 },
      "source-stale-key",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    f.work.saveSource(
      o,
      "source-local",
      { ...source, url: "http://127.0.0.1" },
      "source-local-key",
    ),
    { statusCode: 422 },
  );
  f.revoke();
  await assert.rejects(
    f.work.saveSource(o, row.id, source, "source-original-key"),
    { statusCode: 403 },
  );
});
test("collection survives queue loss, freezes original document and deduplicates explicit imports without touching private facts", async () => {
  const f = setup();
  f.queue.markNextAddAsFailure();
  const created = await f.work.create(o, request, "collect-original-key");
  assert.equal(
    (await f.work.read(o, created.id)).error_code,
    "QUEUE_UNAVAILABLE",
  );
  await f.runner.recover();
  assert.equal(JSON.stringify(f.queue.jobs).includes("Original first"), false);
  await f.runner.execute(o, created.id);
  const done = await f.work.read(o, created.id);
  assert.equal(done.status, "succeeded");
  assert.ok(done.output!.document!.body.includes("<p>"));
  assert.equal(
    done.output!.entries![0].body,
    "Original first paragraph\n\nSecond original paragraph",
  );
  assert.equal(
    (
      await f.repo.independentReading.list(o, {
        filter: "all",
        search: "",
        after: "",
        limit: 50,
      })
    ).length,
    0,
  );
  const b = {
    base_revision: done.revision,
    output_digest: done.output_digest,
    index: 0,
    base_article_revision: null,
  };
  const imported = await f.work.adopt(o, done.id, b, "collect-adopt-original");
  assert.deepEqual(
    await f.work.adopt(o, done.id, b, "collect-adopt-original"),
    imported,
  );
  const article = await f.repo.independentReading.get(o, imported.article_id);
  assert.equal(article!.personal.read, false);
  assert.equal(article!.personal.notes, "");
  const another = await f.work.create(o, request, "collect-another-key");
  await f.runner.execute(o, another.id);
  const next = await f.work.read(o, another.id);
  const same = await f.work.adopt(
    o,
    next.id,
    { ...b, base_revision: next.revision, output_digest: next.output_digest },
    "collect-adopt-dedup",
  );
  assert.equal(same.article_id, imported.article_id);
  assert.equal(
    (
      await f.repo.independentReading.list(o, {
        filter: "all",
        search: "",
        after: "",
        limit: 50,
      })
    ).length,
    1,
  );
  await assert.rejects(
    f.work.create(o, { ...request, title: "Changed" }, "collect-original-key"),
    { statusCode: 409 },
  );
});
test("RSS and Atom retain supplied dates, author, tags and exact download while rejecting DTD/over-capacity and retaining metadata-only candidates", async () => {
  const f = setup();
  await f.work.saveSource(o, "source-rss", source, "rss-source-key");
  const created = await f.work.create(
      o,
      { kind: "collect_source", source_id: "source-rss", base_revision: 1 },
      "rss-create-key",
    ),
    row = (await f.work.store.get(o, created.id))!;
  const xml =
    "<rss><channel><language>en</language><item><title>A &amp; B</title><link>https://example.com/a</link><description><![CDATA[<p>Retained feed excerpt</p>]]></description><author>Original author</author><category>Research</category><pubDate>Wed, 11 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>";
  const output = collectReadingDocument(row, {
    body: xml,
    content_type: "application/rss+xml",
  });
  assert.equal(output.document.body, xml);
  assert.equal(output.document.capture_kind, "feed_entry");
  assert.equal(output.entries[0].title, "A & B");
  assert.equal(output.entries[0].published_at, "2026-11-11T12:00:00.000Z");
  assert.deepEqual(output.entries[0].tags, ["Research"]);
  const atom = { ...row, input: { ...row.input, format: "atom" as const } };
  const a = collectReadingDocument(atom, {
    body: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="https://example.com/atom"/><summary>Unknown date preserved</summary><author><name>Owner</name></author></entry></feed>',
    content_type: "application/atom+xml",
  });
  assert.equal(a.entries[0].published_at, null);
  assert.equal(a.entries[0].author, "Owner");
  const metadataOnly = collectReadingDocument(row, {
    body: xml.replace("Retained feed excerpt", ""),
    content_type: "application/rss+xml",
  });
  assert.equal(metadataOnly.entries.length, 0);
  assert.equal(metadataOnly.candidates![0].excerpt, "");
  assert.equal(metadataOnly.candidates![0].content.title, "A & B");
  assert.ok(metadataOnly.warnings![0].includes("未提供摘要"));
  for (const bad of [
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml,
    "<rss><channel>" +
      Array.from({ length: 81 }, () => "<item/>").join("") +
      "</channel></rss>",
  ])
    assert.throws(() =>
      collectReadingDocument(row, {
        body: bad,
        content_type: "application/rss+xml",
      }),
    );
});
test("AI has all four frozen scopes, personal model selection and explicit draft saving before adoption", async () => {
  const f = setup(),
    reading = new ReadingService(f.repo);
  const article = await reading.write(
    o,
    "article-ai-scope",
    "import",
    {
      base_revision: 0,
      content: {
        title: "Original",
        body: "First paragraph\n\nSecond paragraph",
        source_url: null,
        language: "en",
        published_at: null,
      },
    },
    "article-ai-import",
  );
  let current = article;
  for (const kind of ["guide", "translation", "summary", "english"]) {
    const request = {
      kind,
      article_id: article.id,
      content_version: article.content_version,
      paragraph_id: kind === "translation" ? "p-2" : null,
    };
    const created = await f.work.create(o, request, "ai-create-" + kind);
    const input = (await f.work.store.get(o, created.id))!.input;
    assert.equal(
      input.text,
      kind === "translation" ? "Second paragraph" : article.content.body,
    );
    assert.equal(input.model_selection!.mode, "platform");
    await f.runner.execute(o, created.id);
    const done = await f.work.read(o, created.id);
    assert.equal(done.status, "succeeded");
    assert.equal(
      (await reading.read(o, article.id)).revision,
      current.revision,
    );
    const result = await f.work.adopt(
      o,
      done.id,
      {
        base_revision: done.revision,
        output_digest: done.output_digest,
        index: null,
        base_article_revision: current.revision,
      },
      "ai-save-draft-" + kind,
    );
    current = await reading.read(o, result.article_id);
    const material = current.materials!.find((m) => m.kind === kind)!;
    assert.equal(material.draft.origin, "ai");
    assert.equal(material.adopted, null);
    assert.equal(current.personal.read, false);
  }
  assert.equal(f.calls(), 4);
  await assert.rejects(
    f.work.create(
      o,
      {
        kind: "translation",
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: "p-3",
      },
      "ai-invalid-paragraph",
    ),
    { statusCode: 422 },
  );
});
test("cancel, consent change, lease interruption and owner deletion cannot publish late network/model results", async () => {
  for (const mode of ["cancel", "expire", "delete", "revoke"]) {
    let start!: () => void, release!: (value: any) => void;
    const started = new Promise<void>((r) => (start = r)),
      waiting = new Promise<any>((r) => (release = r));
    const f = setup(async () => {
      start();
      return waiting;
    });
    const article = await new ReadingService(f.repo).write(
      o,
      "article-late-ai",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Article",
          body: "Source",
          source_url: null,
          language: "unknown",
          published_at: null,
        },
      },
      "late-import",
    );
    const work = await f.work.create(
        o,
        {
          kind: "summary",
          article_id: article.id,
          content_version: article.content_version,
          paragraph_id: null,
        },
        "late-create",
      ),
      run = f.runner.execute(o, work.id);
    await started;
    if (mode === "cancel") {
      const current = await f.work.read(o, work.id);
      await f.work.cancel(
        o,
        work.id,
        { base_revision: current.revision },
        "late-cancel",
      );
    } else if (mode === "expire") {
      f.advance();
      await f.runner.recover();
    } else if (mode === "delete") await f.repo.deleteOwnerData(o);
    else f.revoke();
    release({
      text: "Late provider output",
      provider: "synthetic",
      providerModel: "fixture",
    });
    await run;
    const stored = await f.repo.readingWork.get(o, work.id);
    assert.equal(stored?.output ?? null, null);
    if (mode === "expire")
      assert.equal(stored!.error_code, "INTERRUPTED_OUTCOME_UNKNOWN");
    if (mode === "delete") assert.equal(stored, undefined);
  }
});
test("source/work/receipt failure rolls back all changes; exported account includes recoverable source history and outputs", async () => {
  const f = setup();
  await f.work.saveSource(o, "source-export", source, "export-source-key");
  const save = f.repo.saveOperation.bind(f.repo);
  f.repo.saveOperation = async () => {
    throw Error("receipt failure");
  };
  await assert.rejects(
    f.work.saveSource(
      o,
      "source-export",
      { ...source, base_revision: 1, title: "Must rollback" },
      "export-source-bad",
    ),
    /receipt failure/,
  );
  f.repo.saveOperation = save;
  assert.equal(
    (await f.work.sourceHistory(o, "source-export")).items.length,
    1,
  );
  const result = await exportReview(f.repo, o, async () => {});
  const data = JSON.parse(result.content);
  assert.equal(data.reading.sources[0].id, "source-export");
  assert.equal(data.reading.source_history[0].versions.length, 1);
  assert.equal(typeof result.sha256, "string");
});

test("personal model revision is frozen and late credential changes reject output even when a provider ignores cancellation", async () => {
  let release!: (v: any) => void, start!: () => void;
  const started = new Promise<void>((r) => (start = r)),
    waiting = new Promise<any>((r) => (release = r));
  const f = setup(async (request) => {
    assert.equal(
      request.providerOptions.zookLightTickModelSelection.mode,
      "personal",
    );
    start();
    return waiting;
  });
  const state = {
    mode: "personal" as const,
    revision: 1,
    base_url: null,
    model_name: null,
    secret: null,
    updated_at: new Date().toISOString(),
  };
  await f.repo.personalModels.save(o, state, 0);
  const article = await new ReadingService(f.repo).write(
    o,
    "article-model-rev",
    "import",
    {
      base_revision: 0,
      content: {
        title: "Original",
        body: "Owner selected text",
        source_url: null,
        language: "en",
        published_at: null,
      },
    },
    "model-revision-import",
  );
  const job = await f.work.create(
      o,
      {
        kind: "guide",
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: null,
      },
      "model-revision-create",
    ),
    run = f.runner.execute(o, job.id);
  await started;
  await f.repo.personalModels.save(o, { ...state, revision: 2 }, 1);
  release({
    text: "Late result",
    provider: "synthetic",
    providerModel: "fixture",
  });
  await run;
  const result = await f.work.read(o, job.id);
  assert.equal(result.output, null);
  assert.equal(result.error_code, "PERSONAL_MODEL_SETTINGS_CHANGED");
});
test("model and collection daily budgets are independent, bounded and never block historical original receipts", async () => {
  const f = setup();
  for (let i = 0; i < 20; i++) {
    const job = await f.work.create(o, request, "budget-collect-" + i);
    await f.work.cancel(
      o,
      job.id,
      { base_revision: job.revision },
      "budget-cancel-" + i,
    );
  }
  await assert.rejects(f.work.create(o, request, "budget-overflow"), {
    statusCode: 429,
  });
  assert.equal(
    (await f.work.create(o, request, "budget-collect-0")).revision,
    1,
  );
  const g = setup(),
    article = await new ReadingService(g.repo).write(
      o,
      "article-budget-ai",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Original",
          body: "Original",
          source_url: null,
          language: "unknown",
          published_at: null,
        },
      },
      "budget-ai-import",
    );
  for (let i = 0; i < 12; i++) {
    const job = await g.work.create(
      o,
      {
        kind: "summary",
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: null,
      },
      "budget-ai-" + i,
    );
    await g.work.cancel(
      o,
      job.id,
      { base_revision: job.revision },
      "budget-ai-cancel-" + i,
    );
  }
  await assert.rejects(
    g.work.create(
      o,
      {
        kind: "summary",
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: null,
      },
      "budget-ai-overflow",
    ),
    { statusCode: 429 },
  );
  assert.ok(await g.work.create(o, request, "budget-url-after-ai"));
});

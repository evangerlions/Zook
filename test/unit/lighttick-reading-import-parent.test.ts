import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
test("full-text adoption retains its explicitly selected parent even when the same URL has multiple roots", async () => {
  const repo = new InMemoryLightTickRepository(),
    o = { appId: "lighttick", userId: "reading-import-full-parent" } as const,
    reading = new ReadingService(repo),
    work = new ReadingWorkService(repo, new InMemoryJobQueue());
  const content = {
    title: "First original",
    body: "Original partial source",
    source_url: "https://reading.example.test/parent",
    language: "en",
    published_at: null,
  };
  const parent = await reading.write(
    o,
    "article-import-parent-one",
    "import",
    { base_revision: 0, content },
    "reading-import-parent-one-key",
  );
  const otherContent = { ...content, title: "Other independent root" },
    scope = await reading.previewImport(o, { content: otherContent });
  const other = await reading.write(
    o,
    "article-import-parent-other",
    "import",
    {
      base_revision: 0,
      content: otherContent,
      import_decision: {
        scope_digest: scope.digest,
        mode: "independent",
        article_id: null,
      },
    },
    "reading-import-parent-other-key",
  );
  const created = await work.create(
    o,
    {
      kind: "fetch_full",
      article_id: parent.id,
      content_version: parent.content_version,
    },
    "reading-import-full-work-key",
  );
  await new ReadingWorkRunner(work, {} as any, async () => ({
    body: "<p>" + "Distinct full text keeps the selected parent's identity and boundaries. ".repeat(3) + "</p>",
    content_type: "text/html",
  })).execute(o, created.id);
  const done = await work.read(o, created.id);
  assert.equal(done.status,"succeeded",JSON.stringify({status:done.status,error:done.error_code,output:done.output}));
  const review = await work.importPreview(o, created.id, 0),
    body = {
      base_revision: done.revision,
      output_digest: done.output_digest,
      index: 0,
      base_article_revision: null,
    };
  await assert.rejects(
    work.adopt(
      o,
      done.id,
      {
        ...body,
        import_decision: {
          scope_digest: review.digest,
          mode: "edition",
          article_id: other.id,
        },
      },
      "reading-import-wrong-parent",
    ),
    { statusCode: 409 },
  );
  const adopted = await work.adopt(
    o,
    done.id,
    {
      ...body,
      import_decision: {
        scope_digest: review.digest,
        mode: "edition",
        article_id: parent.id,
      },
    },
    "reading-import-right-parent",
  );
  const article = await reading.read(o, adopted.article_id);
  assert.equal(article.provenance!.parent_article_id, parent.id);
  assert.equal(article.provenance!.root_article_id, parent.id);
});

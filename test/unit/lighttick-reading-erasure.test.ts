import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { exerciseReadingErasure } from "../support/reading-erasure-acceptance.ts";
test("article erasure is atomic, preview-frozen, owner-isolated and keeps independent knowledge/practice while redacting old receipts and shared captures", async () => {
  await exerciseReadingErasure(new InMemoryLightTickRepository());
});
import assert from "node:assert/strict";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { ReadingErasureService } from "../../src/modules/lighttick/independent-reading/reading-erasure.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
test("article erasure fences an in-flight model that ignores cancellation and later explicit collection uses a new identity without old private facts", async () => {
  const repo = new InMemoryLightTickRepository(),
    o = { appId: "lighttick", userId: "erasure-late-owner" } as const;
  let now = new Date("2026-11-12T06:00:00Z");
  const clock = () => now,
    reading = new ReadingService(repo, undefined, clock),
    erase = new ReadingErasureService(repo, undefined, clock),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      undefined,
      clock,
    );
  const content = {
      title: "Old original",
      body: "Selected original for model",
      language: "en",
      source_url: null,
      published_at: null,
    },
    id = "article-" + digest(content).slice(0, 40);
  const article = await reading.write(
    o,
    id,
    "import",
    { base_revision: 0, content },
    "erasure-late-import",
  );
  const job = await work.create(
    o,
    {
      kind: "summary",
      article_id: id,
      content_version: article.content_version,
      paragraph_id: null,
    },
    "erasure-late-model",
  );
  let finish!: (v: any) => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        entered();
        return new Promise<any>((r) => (finish = r));
      },
    },
    async () => {
      throw Error("unused fetch");
    },
  );
  const running = runner.execute(o, job.id);
  await started;
  const p = await erase.preview(o, id);
  await erase.erase(
    o,
    id,
    {
      base_revision: p.base_revision,
      content_version: p.content_version,
      scope_digest: p.scope_digest,
    },
    "erasure-late-delete",
  );
  finish({
    text: "LATE PRIVATE MODEL OUTPUT",
    provider: "synthetic",
    providerModel: "fixture",
  });
  await running;
  assert.equal(
    (await repo.readingWork.get(o, job.id))!.error_code,
    "DATA_ERASED",
  );
  assert.equal((await repo.readingWork.get(o, job.id))!.output, null);
  now = new Date(now.getTime() + 1000);
  const fresh = {
    ...o,
    id: "readwork-erasure-later-import",
    revision: 1,
    kind: "collect_url" as const,
    status: "succeeded" as const,
    input: { url: "https://reading.example.test/new-review" },
    output: { entries: [content] },
    adopted: {},
    attempt: 1,
    fence: null,
    lease_until: null,
    error_code: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  await repo.readingWork.save(fresh, 0);
  const copied = await work.adopt(
    o,
    fresh.id,
    {
      base_revision: 1,
      output_digest: digest(fresh.output),
      index: 0,
      base_article_revision: null,
      response_view: "summary",
      import_decision: { scope_digest: (await work.importPreview(o, fresh.id, 0)).digest, mode: "independent", article_id: null },
    },
    "erasure-new-copy",
  );
  assert.notEqual(copied.article_id, id);
  assert.equal((await reading.read(o, copied.article_id)).personal.read, false);
  assert.equal((await reading.read(o, copied.article_id)).personal.notes, "");
  const old = {
    ...fresh,
    id: "readwork-erasure-before-import",
    created_at: "2026-11-12T05:59:59Z",
  };
  await repo.readingWork.save(old, 0);
  await assert.rejects(
    work.adopt(
      o,
      old.id,
      {
        base_revision: 1,
        output_digest: digest(old.output),
        index: 0,
        base_article_revision: null,
        response_view: "summary",
      },
      "erasure-old-copy-blocked",
    ),
    { statusCode: 410 },
  );
});

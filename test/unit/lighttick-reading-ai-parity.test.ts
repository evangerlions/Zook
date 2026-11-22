import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { exerciseReadingAIParity } from "../support/reading-ai-parity-acceptance.ts";
import { readingSelectedText } from "../../src/modules/lighttick/independent-reading/reading-scope.ts";
import { validateReadingGuide } from "../../src/modules/lighttick/independent-reading/reading-ai-snapshot.ts";
import { syntheticReadingGuide } from "../support/reading-guide-fixture.ts";
test("all four reading AI types freeze explicit Unicode scopes, source/prompt evidence and unknown cost while preserving manual/adopted history and independent ranges", async () => {
  await exerciseReadingAIParity(new InMemoryLightTickRepository());
});
test("reading ranges do not split surrogate pairs and guide shape failures cannot be passed off as complete five-section outputs", () => {
  assert.deepEqual(
    readingSelectedText("a🙂中\n\nlast", null, { start: 1, end: 3 }),
    { text: "🙂中", range: { start: 1, end: 3 } },
  );
  assert.deepEqual(readingSelectedText("a🙂中\n\nlast", "p-2"), {
    text: "last",
    range: { start: 5, end: 9 },
  });
  assert.throws(() => readingSelectedText("a🙂", null, { start: 1, end: 3 }));
  assert.throws(() => readingSelectedText("a🙂", "p-1", { start: 0, end: 1 }));
  validateReadingGuide(syntheticReadingGuide);
  assert.throws(() =>
    validateReadingGuide(
      syntheticReadingGuide.replace("## 证据与边界", "## 错误栏目"),
    ),
  );
  assert.throws(() =>
    validateReadingGuide(syntheticReadingGuide.replace("- 第三，", "第三，")),
  );
  assert.throws(() => validateReadingGuide("# 简短标题\n## 中文导读\n不足"));
});
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import {
  freezeReadingAI,
  readingModelUsage,
} from "../../src/modules/lighttick/independent-reading/reading-ai-snapshot.ts";
test("legacy queued prompts stay1.0, feed/legacy source basis is explicit and a malformed five-section output retains actual usage without becoming a draft", async () => {
  const repo = new InMemoryLightTickRepository(),
    o = { appId: "lighttick", userId: "reading-ai-compat-synthetic" } as const,
    clock = () => new Date("2026-11-12T09:00:00Z"),
    reading = new ReadingService(repo, undefined, clock),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      undefined,
      clock,
    ),
    article = await reading.write(
      o,
      "article-ai-compat",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Source",
          body: "Known selected source paragraph.",
          source_url: null,
          language: "en",
          published_at: null,
        },
      },
      "reading-ai-compat-import",
    );
  const provenance = {
    kind: "feed_entry" as const,
    work_id: null,
    source_id: null,
    parent_article_id: null,
    root_article_id: article.id,
    fetched_at: null,
    raw_sha256: null,
  };
  assert.equal(
    freezeReadingAI(
      { ...article, provenance },
      "guide",
      null,
      undefined,
      "reading-v2",
    ).snapshot.source_basis,
    "feed_excerpt",
  );
  assert.equal(
    freezeReadingAI(
      { ...article, provenance: { ...provenance, kind: "legacy_import" } },
      "summary",
      null,
      undefined,
      undefined,
    ).snapshot.source_basis,
    "legacy_unknown",
  );
  let calls = 0;
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async () => {
        calls++;
        return {
          text: "Incomplete model output",
          provider: "synthetic",
          providerModel: "fixture",
          usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
        };
      },
    } as any,
    async () => {
      throw Error("No fetch expected");
    },
  );
  const old = {
    ...o,
    id: "readwork-ai-legacy",
    revision: 1,
    kind: "summary" as const,
    status: "queued" as const,
    input: {
      article_id: article.id,
      content_version: article.content_version,
      paragraph_id: null,
      text: article.content.body,
    },
    output: null,
    adopted: {},
    attempt: 0,
    fence: null,
    lease_until: null,
    error_code: null,
    created_at: clock().toISOString(),
    updated_at: clock().toISOString(),
  };
  await repo.readingWork.save(old, 0);
  await runner.execute(o, old.id);
  const legacy = await work.read(o, old.id);
  assert.equal(legacy.output!.prompt_version, "1.0.0");
  assert.equal(legacy.output!.evidence, undefined);
  const bad = await work.create(
    o,
    {
      kind: "guide",
      guide_format: "reading-v2",
      article_id: article.id,
      content_version: article.content_version,
      paragraph_id: null,
    },
    "reading-ai-bad-guide",
  );
  await runner.execute(o, bad.id);
  const failed = await work.read(o, bad.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_code, "READING_OUTPUT_INVALID");
  assert.equal(failed.output, null);
  assert.equal(failed.model_usage!.total_tokens, 25);
  assert.equal((await reading.read(o, article.id)).materials, undefined);
  const frozen = await work.create(
      o,
      {
        kind: "summary",
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: null,
      },
      "reading-ai-tamper-digest",
    ),
    row = (await repo.readingWork.get(o, frozen.id))!;
  row.input.ai_context!.messages[1].content = "changed snapshot";
  await repo.readingWork.save(
    { ...row, revision: row.revision + 1 },
    row.revision,
  );
  await runner.execute(o, row.id);
  assert.equal(
    (await work.read(o, row.id)).error_code,
    "READING_CONTEXT_STALE",
  );
  assert.equal(calls, 2);
  assert.equal(readingModelUsage(), null);
  assert.equal(
    readingModelUsage({
      promptTokens: NaN,
      completionTokens: 1,
      totalTokens: 1,
    }),
    null,
  );
  assert.equal(
    readingModelUsage({
      promptTokens: 2 ** 40,
      completionTokens: 1,
      totalTokens: 2 ** 40 + 1,
    }),
    null,
  );
});

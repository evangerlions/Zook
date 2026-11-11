import assert from "node:assert/strict";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import { readingTextSHA } from "../../src/modules/lighttick/reading/reading-ai-snapshot.ts";
import { syntheticReadingGuide } from "./reading-guide-fixture.ts";
export const readingAIParityOwner = {
  appId: "lighttick",
  userId: "reading-ai-parity-synthetic",
} as const;
export async function exerciseReadingAIParity(repo: LightTickRepository) {
  const o = readingAIParityOwner,
    queue = new InMemoryJobQueue();
  let now = new Date("2026-11-12T08:00:00Z"),
    calls = 0;
  const reading = new ReadingService(repo, undefined, () => now),
    work = new ReadingWorkService(repo, queue, undefined, () => now),
    requests: any[] = [];
  let article = await reading.write(
    o,
    "article-ai-parity-original",
    "import",
    {
      base_revision: 0,
      content: {
        title: "Frozen synthetic source",
        body:
          "🙂甲乙 original argument. ".repeat(4000) +
          "\n\nLast paragraph kept independent.",
        author: "Synthetic author",
        language: "en",
        source_url: "https://reading.example.test/ai-parity",
        published_at: null,
      },
    },
    "reading-ai-parity-import",
  );
  await assert.rejects(
    work.create(
      o,
      {
        kind: "summary",
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: null,
      },
      "reading-ai-parity-too-large",
    ),
    { statusCode: 413 },
  );
  assert.equal(queue.jobs.length, 0);
  const output = (kind: string) =>
    kind === "guide" ? syntheticReadingGuide : "Synthetic output for " + kind;
  const runner = new ReadingWorkRunner(
    work,
    {
      complete: async (request: any) => {
        calls++;
        requests.push(structuredClone(request.messages));
        now = new Date(now.getTime() + 10);
        return {
          text: request.messages[1].content.includes("五")
            ? syntheticReadingGuide
            : output(
                request.messages[1].content.includes("中文导读")
                  ? "guide"
                  : "other",
              ),
          provider: "synthetic",
          providerModel: "fixture-v1",
          usage: {
            promptTokens: 101,
            completionTokens: 37,
            totalTokens: 138,
            estimated: true,
            cachedInputTokens: 4,
          },
        };
      },
    } as any,
    async () => {
      throw Error("No fetch expected");
    },
  );
  const range = { start: 0, end: 300 };
  for (const kind of ["guide", "translation", "summary", "english"] as const) {
    const request = {
        kind,
        article_id: article.id,
        content_version: article.content_version,
        paragraph_id: null,
        source_range: range,
        ...(kind === "guide" ? { guide_format: "reading-v2" } : {}),
      },
      key = "reading-ai-parity-" + kind;
    const created = await work.create(o, request, key),
      internal = (await repo.readingWork.get(o, created.id))!;
    assert.equal(
      internal.input.text,
      Array.from(article.content.body).slice(0, 300).join(""),
    );
    assert.equal(
      internal.input.ai_context!.input_sha256,
      readingTextSHA(internal.input.text!),
    );
    assert.equal(
      internal.input.ai_context!.prompt_sha256,
      digest(internal.input.ai_context!.messages),
    );
    article = await reading.write(
      o,
      article.id,
      "personal",
      {
        base_revision: article.revision,
        content_version: article.content_version,
        personal: {
          notes: "PRIVATE NOTES must never enter model",
          feedback: "PRIVATE FEEDBACK",
          read: false,
          later: false,
          bookmark: false,
        },
      },
      "reading-ai-private-" + kind,
    );
    await runner.execute(o, created.id);
    const done = await work.read(o, created.id);
    assert.equal(done.status, "succeeded", done.error_code ?? "");
    assert.equal(done.output!.prompt_version, "1.1.0");
    assert.equal(
      done.output!.evidence!.input_sha256,
      internal.input.ai_context!.input_sha256,
    );
    assert.deepEqual(requests.at(-1), internal.input.ai_context!.messages);
    assert.equal(
      JSON.stringify(requests.at(-1)).includes("PRIVATE NOTES"),
      false,
    );
    assert.equal(done.model_usage!.total_tokens, 138);
    assert.equal(done.model_usage!.estimated, true);
    assert.equal(done.model_usage!.cost_amount, null);
    assert.equal(done.model_usage!.reasoning_tokens, null);
    assert.equal(
      Date.parse(done.finished_at!) - Date.parse(done.started_at!),
      10,
    );
    const adopted = await work.adopt(
      o,
      done.id,
      {
        base_revision: done.revision,
        output_digest: done.output_digest,
        index: null,
        base_article_revision: article.revision,
        response_view: "summary",
      },
      "reading-ai-draft-" + kind,
    );
    article = await reading.read(o, article.id);
    const material = article.materials!.find((m) => m.kind === kind)!;
    assert.equal(material.adopted, null);
    assert.deepEqual(material.source_range, range);
    assert.equal(material.draft.evidence!.work_id, done.id);
    assert.equal(
      material.draft.evidence!.output_sha256,
      readingTextSHA(material.draft.text),
    );
    assert.equal(article.personal.read, false);
    assert.equal(adopted.revision, article.revision);
    assert.equal(
      (await work.create(o, request, key)).revision,
      created.revision,
    );
    await assert.rejects(
      work.create(o, { ...request, source_range: { start: 1, end: 300 } }, key),
      { statusCode: 409 },
    );
  }
  const summary = article.materials!.find((m) => m.kind === "summary")!,
    aiVersion = summary.draft;
  article = await reading.write(
    o,
    article.id,
    "draft",
    {
      base_revision: article.revision,
      content_version: article.content_version,
      kind: "summary",
      paragraph_id: null,
      source_range: range,
      text: "My edited synthetic interpretation.",
    },
    "reading-ai-manual-edit",
  );
  let current = article.materials!.find((m) => m.kind === "summary")!;
  assert.equal(current.draft.origin, "manual");
  assert.deepEqual(current.draft.derived_from, {
    version: 1,
    origin: "ai",
    work_id: aiVersion.evidence!.work_id,
  });
  assert.equal(current.draft.evidence, undefined);
  article = await reading.write(
    o,
    article.id,
    "adopt",
    {
      base_revision: article.revision,
      content_version: article.content_version,
      kind: "summary",
      paragraph_id: null,
      source_range: range,
      draft_version: 2,
    },
    "reading-ai-explicit-adopt",
  );
  assert.equal(
    article.materials!.find((m) => m.kind === "summary")!.adopted!.text,
    "My edited synthetic interpretation.",
  );
  article = await reading.write(
    o,
    article.id,
    "draft",
    {
      base_revision: article.revision,
      content_version: article.content_version,
      kind: "summary",
      paragraph_id: null,
      source_range: { start: 300, end: 500 },
      text: "A different range, independent draft.",
    },
    "reading-ai-independent-range",
  );
  assert.equal(
    article.materials!.filter((m) => m.kind === "summary").length,
    2,
  );
  current = article.materials!.find(
    (m) => m.kind === "summary" && m.source_range!.start === 0,
  )!;
  assert.equal(current.adopted!.version, 2);
  const history = await reading.history(o, article.id);
  assert.ok(
    history.items.some((v) =>
      v.materials?.some(
        (m) =>
          m.kind === "summary" &&
          m.draft.evidence?.work_id === aiVersion.evidence!.work_id,
      ),
    ),
  );
  return { article, work_ids: requests.length, calls };
}

import { VocabularyService } from "../../src/modules/lighttick/reading/vocabulary.service.ts";
import assert from "node:assert/strict";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ReadingErasureService } from "../../src/modules/lighttick/reading/reading-erasure.service.ts";
import { ReadingBackupService } from "../../src/modules/lighttick/reading/reading-backup.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
import { ReviewService } from "../../src/modules/lighttick/knowledge/review.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
export const erasureOwner = {
  appId: "lighttick",
  userId: "reading-erasure-synthetic",
} as const;
export async function exerciseReadingErasure(repo: LightTickRepository) {
  const o = erasureOwner,
    other = { ...o, userId: "reading-erasure-other" },
    now = new Date("2026-11-12T05:00:00Z"),
    clock = () => now;
  const reading = new ReadingService(repo, undefined, clock),
    erasure = new ReadingErasureService(repo, undefined, clock),
    backups = new ReadingBackupService(repo, undefined, clock),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      undefined,
      clock,
    ),
    knowledge = new KnowledgeService(repo),
    review = new ReviewService(repo),
    actions = new ActionService(repo, clock, undefined, true);
  const content = {
    title: "Private erasure synthetic original",
    body: "PRIVATE ORIGINAL erasure marker.\n\nSecond independent paragraph.",
    source_url: "https://reading.example.test/erasure",
    language: "en",
    published_at: null,
  };
  const originalBody = { base_revision: 0, content };
  let a = await reading.write(
    o,
    "article-erasure-target",
    "import",
    originalBody,
    "erasure-original-import",
  );
  await reading.write(
    other,
    a.id,
    "import",
    originalBody,
    "erasure-other-import",
  );
  const second = await reading.write(
    o,
    "article-erasure-independent",
    "import",
    {
      base_revision: 0,
      content: { ...content, title: "Independent surviving article" },
      import_decision: { scope_digest: (await reading.previewImport(o, {content: {...content, title: "Independent surviving article"}})).digest, mode: "independent", article_id: null },
    },
    "erasure-independent-import",
  );
  const k = await knowledge.mutate(
    o,
    "knowledge-erasure-independent",
    "save",
    {
      base_revision: 0,
      kind: "knowledge",
      title: "Independent authored interpretation",
      body: "Retain my own interpretation.",
      tags: [],
      sources: [{ kind: "article", id: a.id, version: a.content_version }],
    },
    "erasure-knowledge-import",
  );
  const { plan } = (await actions.request(o, "POST", "/practices", {
    key: "erasure-practice-original",
    source_kind: "article",
    source_id: a.id,
    source_version: a.content_version,
    title: "Independent practice",
    date: null,
  })) as any;
  a = await reading.write(
    o,
    a.id,
    "personal",
    {
      base_revision: 1,
      content_version: a.content_version,
      personal: {
        notes: "PRIVATE NOTES erasure marker",
        feedback: "",
        bookmark: false,
        later: false,
        read: false,
      },
    },
    "erasure-private-original",
  );
  const vocabulary = new VocabularyService(repo, undefined, clock),
    wordBody = {
      base_revision: 0,
      word: "PRIVATE WORD",
      article_id: a.id,
      source_version: a.content_version,
      context_sentence: "PRIVATE context",
      contextual_meaning: "PRIVATE meaning",
      part_of_speech: "noun",
      pronunciation: "",
    };
  await vocabulary.write(
    o,
    "vocab-erasure-current",
    "add",
    wordBody,
    "erasure-word-add",
  );
  await vocabulary.write(
    o,
    "vocab-erasure-current",
    "review",
    { base_revision: 1, feedback: "good" },
    "erasure-word-review",
  );
  await vocabulary.write(
    o,
    "vocab-erasure-deleted",
    "add",
    { ...wordBody, word: "PRIOR DELETED WORD" },
    "erasure-old-word-add",
  );
  await vocabulary.write(
    o,
    "vocab-erasure-deleted",
    "delete",
    { base_revision: 1 },
    "erasure-old-word-delete",
  );
  const job = {
    ...o,
    id: "readwork-erasure-shared",
    revision: 1,
    kind: "collect_source" as const,
    status: "succeeded" as const,
    input: {
      source_id: "source-synthetic",
      url: "https://reading.example.test/feed",
    },
    output: { entries: [content, second.content] },
    adopted: {
      "0": { article_id: a.id, revision: 1 },
      "1": { article_id: second.id, revision: 1 },
    },
    attempt: 1,
    fence: null,
    lease_until: null,
    error_code: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  await repo.readingWork.save(job, 0);
  const value = {
    body: "PRIVATE RAW erasure marker",
    content_type: "text/plain",
    url: content.source_url,
    sha256: "a".repeat(64),
    capture_kind: "web_text",
  };
  await repo.readingWork.assets.save(o, {
    id: "readasset-erasure-shared",
    work_id: job.id,
    kind: "document",
    sha256: digest(value),
    value,
  });
  const pending = await work.create(
    o,
    {
      kind: "summary",
      article_id: a.id,
      content_version: a.content_version,
      paragraph_id: null,
    },
    "erasure-pending-original",
  );
  const backup = await backups.create(
    o,
    { format: "lighttick-reading-ndjson-v2" },
    "erasure-backup-original",
  );
  const preview = await erasure.preview(o, a.id);
  assert.deepEqual(
    preview.work.find((w) => w.id === job.id)!.other_article_ids,
    [second.id],
  );
  assert.equal(preview.backups.length, 1);
  assert.equal(preview.vocabulary.length, 1);
  await assert.rejects(erasure.preview(other, "article-erasure-independent"), {
    statusCode: 404,
  });
  await assert.rejects(
    erasure.erase(
      o,
      a.id,
      {
        base_revision: a.revision,
        content_version: a.content_version,
        scope_digest: "0".repeat(64),
      },
      "erasure-stale-preview",
    ),
    { statusCode: 409 },
  );
  assert.equal(
    (await reading.read(o, a.id)).personal.notes,
    "PRIVATE NOTES erasure marker",
  );
  const command = {
    base_revision: a.revision,
    content_version: a.content_version,
    scope_digest: preview.scope_digest,
  };
  await assert.rejects(
    repo.transaction(o, async () => {
      await erasure.erase(o, a.id, command, "erasure-rollback-original");
      throw Error("rollback synthetic erasure");
    }),
    /rollback synthetic erasure/,
  );
  assert.equal((await reading.read(o, a.id)).revision, a.revision);
  assert.equal((await repo.readingWork.get(o, pending.id))!.status, "queued");
  assert.equal((await backups.read(o, backup.id)).id, backup.id);
  const result = await erasure.erase(
    o,
    a.id,
    command,
    "erasure-delete-original",
  );
  assert.deepEqual(
    await erasure.erase(o, a.id, command, "erasure-delete-original"),
    result,
  );
  assert.deepEqual(
    (await erasure.receipt(o, "erasure-delete-original")).result,
    result,
  );
  await assert.rejects(
    erasure.erase(
      o,
      a.id,
      { ...command, base_revision: 1 },
      "erasure-delete-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(reading.read(o, a.id), {
    statusCode: 410,
    code: "LIGHTTICK_READING_ERASED",
  });
  await assert.rejects(reading.receipt(o, "erasure-original-import"), {
    statusCode: 410,
  });
  await assert.rejects(
    reading.write(o, a.id, "import", originalBody, "erasure-original-import"),
    { statusCode: 410 },
  );
  await assert.rejects(
    reading.write(o, a.id, "import", originalBody, "erasure-attempt-recreate"),
    { statusCode: 410 },
  );
  await assert.rejects(
    work.create(
      o,
      {
        kind: "summary",
        article_id: a.id,
        content_version: a.content_version,
        paragraph_id: null,
      },
      "erasure-pending-original",
    ),
    { statusCode: 410 },
  );
  await assert.rejects(
    vocabulary.write(
      o,
      "vocab-erasure-current",
      "add",
      wordBody,
      "erasure-word-add",
    ),
    { statusCode: 410 },
  );
  await assert.rejects(
    vocabulary.write(
      o,
      "vocab-erasure-deleted",
      "add",
      { ...wordBody, word: "PRIOR DELETED WORD" },
      "erasure-old-word-add",
    ),
    { statusCode: 410 },
  );
  assert.equal(
    await repo.reading.getVocabulary(o, "vocab-erasure-current"),
    undefined,
  );
  assert.equal(
    (await repo.reading.listVocabularyReviews(o, "vocab-erasure-current"))
      .length,
    0,
  );
  assert.equal(
    (await repo.readingWork.get(o, pending.id))!.status,
    "cancelled",
  );
  assert.equal((await repo.readingWork.get(o, pending.id))!.fence, null);
  assert.deepEqual((await repo.readingWork.get(o, pending.id))!.input, {
    article_id: a.id,
    content_version: a.content_version,
  });
  assert.equal((await repo.readingWork.get(o, job.id))!.output, null);
  assert.equal((await repo.readingWork.assets.list(o, job.id)).length, 0);
  assert.equal((await repo.reading.history(o, a.id, 2147483648, 10)).length, 0);
  await assert.rejects(backups.part(o, backup.id, 0), { statusCode: 404 });
  assert.equal(
    (await reading.read(o, second.id)).content.body,
    second.content.body,
  );
  assert.equal((await reading.read(other, a.id)).content.body, a.content.body);
  assert.equal((await knowledge.read(o, k.id)).body, k.body);
  assert.equal((await knowledge.history(o, k.id)).items.length, 1);
  const stats = await review.snapshot(o);
  assert.equal(stats.counts.knowledge, 1);
  assert.equal(stats.counts.article_saved, 1);
  assert.equal(stats.counts.article_read, 0);
  await assert.rejects(
    review.source(o, { kind: "article", id: a.id, version: a.content_version }),
    { statusCode: 403 },
  );
  const practiceSource = (await actions.request(
    o,
    "GET",
    "/practices/" + plan.id + "/source",
  )) as any;
  assert.equal(practiceSource.available, false);
  assert.equal(
    (await repo.getActionWorkspace(o))!.data.plans[0].status,
    "active",
  );
  const tombstones = await repo.readingBackups.entries(o, "articles", "", 100);
  assert.equal(
    tombstones.find((r) => r.key === a.id)!.value &&
      (tombstones.find((r) => r.key === a.id)!.value as any).deleted,
    true,
  );
  const op = (await repo.getOperation(o, "erasure-private-original"))!;
  assert.equal(op.resultPayload.erased, true);
  assert.deepEqual(op.requestPayload, {});
  assert.match(String(op.resultPayload.result_digest), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(op).includes("PRIVATE NOTES"), false);
  const newest = await backups.create(
    o,
    { format: "lighttick-reading-ndjson-v2" },
    "erasure-after-backup",
  );
  assert.equal(newest.counts.articles, 2);
  return { target: a.id, survivor: second.id, result, pending_id: pending.id };
}

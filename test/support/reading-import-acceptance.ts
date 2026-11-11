import assert from "node:assert/strict";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ReadingErasureService } from "../../src/modules/lighttick/reading/reading-erasure.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import type { ReadingImportScope } from "../../src/modules/lighttick/reading/reading-import.types.ts";
export const readingImportOwner = {
  appId: "lighttick",
  userId: "reading-import-synthetic",
} as const;
const choose = (
  scope: ReadingImportScope,
  mode: "independent" | "edition" | "existing",
  article_id: string | null = null,
) => ({ scope_digest: scope.digest, mode, article_id });
export async function exerciseReadingImport(repo: LightTickRepository) {
  const o = readingImportOwner,
    service = new ReadingService(repo),
    erasure = new ReadingErasureService(repo);
  const body = {
    base_revision: 0,
    content: {
      title: "Original retained title",
      body: "Exact source arguments 🙂",
      source_url: "https://Example.COM/a?id=1&utm_source=keep#section",
      language: "en",
      published_at: null,
    },
  };
  let original = await service.write(
    o,
    "article-import-original",
    "import",
    body,
    "reading-import-original-key",
  );
  original = await service.write(
    o,
    original.id,
    "personal",
    {
      base_revision: 1,
      content_version: original.content_version,
      personal: {
        notes: "Independent private note",
        feedback: "Keep original feedback",
        bookmark: true,
        later: true,
        read: false,
      },
    },
    "reading-import-private-key",
  );
  const scope = await service.previewImport(o, { content: body.content });
  assert.equal(scope.identity_version, "whatwg-fragment-v1");
  assert.equal(scope.url_key, "https://example.com/a?id=1&utm_source=keep");
  assert.equal(scope.candidates.length, 1);
  assert.equal(scope.candidates[0].revision, 2);
  assert.equal("body" in scope.candidates[0], false);
  assert.equal("personal" in scope.candidates[0], false);
  await assert.rejects(
    service.write(
      o,
      "article-import-duplicate",
      "import",
      body,
      "reading-import-implicit-duplicate",
    ),
    { statusCode: 409 },
  );
  assert.equal(
    await repo.reading.get(o, "article-import-duplicate"),
    undefined,
  );
  const independent = await service.write(
    o,
    "article-import-independent",
    "import",
    { ...body, import_decision: choose(scope, "independent") },
    "reading-import-independent-key",
  );
  assert.equal(independent.provenance!.root_article_id, independent.id);
  assert.equal(independent.provenance!.parent_article_id, null);
  assert.equal(independent.personal.notes, "");
  assert.equal(independent.personal.bookmark, false);
  assert.deepEqual(
    (await service.read(o, original.id)).personal,
    original.personal,
  );
  await assert.rejects(
    service.write(
      o,
      "article-import-stale",
      "import",
      { ...body, import_decision: choose(scope, "independent") },
      "reading-import-stale-key",
    ),
    { statusCode: 409 },
  );
  const changed = {
    ...body.content,
    body: "New source edition with changed evidence",
  };
  let editionScope = await service.previewImport(o, { content: changed });
  assert.equal(editionScope.candidates.length, 2);
  const edition = await service.write(
    o,
    "article-import-edition",
    "import",
    {
      base_revision: 0,
      content: changed,
      import_decision: choose(editionScope, "edition", independent.id),
    },
    "reading-import-edition-key",
  );
  assert.equal(edition.provenance!.parent_article_id, independent.id);
  assert.equal(edition.provenance!.root_article_id, independent.id);
  assert.equal(edition.personal.notes, "");
  assert.equal((await service.editions(o, edition.id)).items.length, 2);
  assert.equal((await service.editions(o, original.id)).items.length, 1);
  assert.equal(
    (
      await service.previewImport(o, {
        content: {
          ...changed,
          source_url: "http://example.com/a?id=1&utm_source=keep",
        },
      })
    ).candidates.length,
    0,
  );
  assert.equal(
    (
      await service.previewImport(o, {
        content: {
          ...changed,
          source_url: "https://example.com/a?id=2&utm_source=keep",
        },
      })
    ).candidates.length,
    0,
  );
  assert.equal(
    (
      await service.previewImport(o, {
        content: {
          ...changed,
          source_url: "https://example.com/a?utm_source=keep&id=1",
        },
      })
    ).candidates.length,
    0,
  );
  assert.equal(
    (
      await service.previewImport(
        { ...o, userId: "other-import-owner" },
        { content: body.content },
      )
    ).candidates.length,
    0,
  );
  await service.write(
    o,
    original.id,
    "archive",
    { base_revision: original.revision },
    "reading-import-archive-key",
  );
  const archivedScope = await service.previewImport(o, {
    content: body.content,
  });
  assert.equal(
    archivedScope.candidates.find((r) => r.id === original.id)!.archived,
    true,
  );
  assert.equal(
    (
      await service.write(
        o,
        original.id,
        "import",
        body,
        "reading-import-original-key",
      )
    ).revision,
    1,
  );
  assert.equal((await service.read(o, original.id)).revision, 3);
  const preview = await erasure.preview(o, original.id);
  await erasure.erase(
    o,
    original.id,
    {
      base_revision: preview.base_revision,
      content_version: preview.content_version,
      scope_digest: preview.scope_digest,
    },
    "reading-import-erase-key",
  );
  const deleted = await service.previewImport(o, { content: body.content });
  assert.equal(deleted.deleted!.id, original.id);
  await assert.rejects(
    service.write(
      o,
      "article-import-after-delete",
      "import",
      body,
      "reading-import-no-deleted-consent",
    ),
    { statusCode: 409 },
  );
  const recollected = await service.write(
    o,
    "article-import-after-delete",
    "import",
    { ...body, import_decision: choose(deleted, "independent") },
    "reading-import-new-identity-key",
  );
  assert.equal(recollected.personal.notes, "");
  await assert.rejects(service.read(o, original.id), { statusCode: 410 });
  // Collected output can point explicitly to an exact existing article without mutating it.
  const queue = new InMemoryJobQueue(),
    work = new ReadingWorkService(repo, queue),
    runner = new ReadingWorkRunner(work, {} as any, async () => ({
      body: "<article><p>Collected synthetic exact body.</p></article>",
      content_type: "text/html",
    }));
  const job = await work.create(
    o,
    {
      kind: "collect_url",
      url: "https://reading.example.test/import-work",
      title: "Collected original",
    },
    "reading-import-work-create",
  );
  await runner.execute(o, job.id);
  const done = await work.read(o, job.id),
    collected = done.output!.entries![0],
    existing = await service.write(
      o,
      "article-import-preexisting-work",
      "import",
      { base_revision: 0, content: collected },
      "reading-import-existing-work",
    );
  const jobScope = await work.importPreview(o, done.id, 0);
  const adopt = {
    base_revision: done.revision,
    output_digest: done.output_digest,
    index: 0,
    base_article_revision: null,
    import_decision: choose(jobScope, "existing", existing.id),
  };
  const adopted = await work.adopt(
    o,
    done.id,
    adopt,
    "reading-import-work-adopt",
  );
  assert.equal(adopted.article_id, existing.id);
  assert.equal((await service.read(o, existing.id)).revision, 1);
  assert.deepEqual(
    await work.adopt(o, done.id, adopt, "reading-import-work-adopt"),
    adopted,
  );
  await assert.rejects(
    work.adopt(
      o,
      done.id,
      { ...adopt, import_decision: choose(jobScope, "independent") },
      "reading-import-work-adopt",
    ),
    { statusCode: 409 },
  );
  return { original, independent, edition, recollected, existing };
}

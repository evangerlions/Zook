import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { ReadingRecommendationService } from "../../src/modules/lighttick/reading/reading-recommendation.service.ts";
import { ReadingPreferencesService } from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import {
  seedReadingRecommendation,
  recommendationFeed,
  recommendationText,
} from "../support/reading-recommendation-fixture.ts";
const owner = { appId: "lighttick" as const, userId: "batch-unit-owner" },
  clock = () => new Date("2026-11-12T02:00:00Z");
async function setup(count = 8) {
  const repo = new InMemoryLightTickRepository(),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      async () => {},
      clock,
    );
  return {
    repo,
    work,
    ...(await seedReadingRecommendation(work, owner, count)),
  };
}
const noModel = {
  complete: async () => {
    throw Error("No implicit model");
  },
} as any;
test("recommendation counts only acquired full text, bounds body concurrency, freezes provenance, saves selected references with compact replay and keeps original bytes", async () => {
  const f = await setup(),
    created = await f.recommendation.create(
      owner,
      { scope_digest: f.scope.digest },
      "batch-unit-start",
    );
  let live = 0,
    peak = 0,
    models = 0;
  const runner = new ReadingWorkRunner(f.work, noModel, async (url) => {
    if (url.endsWith("/feed"))
      return {
        body: recommendationFeed(),
        content_type: "application/rss+xml",
      };
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return {
      body: "<article><!--\0--><p>" + recommendationText + "</p></article>",
      content_type: "text/html",
    };
  });
  await runner.execute(owner, created.id);
  const ready = await f.work.read(owner, created.id);
  assert.equal(ready.status, "succeeded", JSON.stringify(ready));
  assert.equal(peak, 3);
  assert.equal(models, 0);
  const output = ready.output!;
  assert.equal(output.entry_refs!.length, 8);
  assert.equal(output.recommendation!.selected, 8);
  assert.equal(output.entries, undefined);
  assert.ok(JSON.stringify(ready).length < 20000);
  assert.equal((await f.repo.reading.recommendationHistory(owner)).length, 0);
  const ref = output.entry_refs![0],
    entry = await f.work.asset(owner, created.id, ref.asset_id),
    doc = await f.work.asset(owner, created.id, ref.document_id);
  assert.equal(entry.sha256, digest(entry.value));
  assert.equal((entry.value as any).body, recommendationText.trim());
  assert.equal((doc.value as any).encoding, "base64");
  assert.ok(Buffer.from((doc.value as any).body, "base64").includes(0));
  const body = {
      base_revision: ready.revision,
      output_digest: ready.output_digest,
      index: 0,
      base_article_revision: null,
      response_view: "summary",
    },
    saved = await f.work.adopt(owner, created.id, body, "batch-unit-adopt");
  assert.equal("output" in saved.work, false);
  assert.equal((saved.work as any).has_output, true);
  assert.ok(JSON.stringify(saved).length < 10000);
  assert.deepEqual(
    await f.work.adopt(owner, created.id, body, "batch-unit-adopt"),
    saved,
  );
  const article = await f.repo.reading.get(owner, saved.article_id);
  assert.equal(article!.personal.read, false);
  assert.equal(article!.provenance!.source_id, "source-batch-fixture");
  assert.equal(article!.provenance!.raw_sha256, (doc.value as any).sha256);
  await assert.rejects(
    f.work.asset({ ...owner, userId: "other" }, created.id, ref.asset_id),
    { statusCode: 404 },
  );
  await assert.rejects(
    f.work.store.assets.save(owner, {
      ...entry,
      value: { ...entry.value, title: "overwrite" },
    }),
    { statusCode: 409 },
  );
  assert.equal((await f.work.assets(owner, created.id)).items.length, 17);
  const exported = await new (
    await import("../../src/modules/lighttick/reading/reading.service.ts")
  ).ReadingService(f.repo).export(owner);
  assert.equal(exported.work_assets.length, 17);
});
test("scope rejects changed inputs, explicit empty source selection stays empty and deleted default copies never silently restore the public source", async () => {
  const f = await setup(1);
  const prefs = await f.work.store.preferences.get(owner);
  await new ReadingPreferencesService(f.work).save(
    owner,
    { base_revision: 1, value: { ...prefs!.value, source_ids: [] } },
    "batch-unit-empty",
  );
  await assert.rejects(
    f.recommendation.create(
      owner,
      { scope_digest: f.scope.digest },
      "batch-unit-stale-scope",
    ),
    { statusCode: 409 },
  );
  const scope = await f.recommendation.scope(owner);
  assert.deepEqual(scope.sources, []);
  const source = await f.work.saveSource(
    owner,
    "source-catalog-aeon",
    {
      base_revision: 0,
      title: "My copy",
      url: "https://example.com/edited",
      format: "rss",
      archived: false,
    },
    "batch-default-edit",
  );
  await f.work.deleteSource(
    owner,
    source.id,
    { base_revision: 1 },
    "batch-default-delete",
  );
  const pref = await f.work.store.preferences.get(owner);
  await new ReadingPreferencesService(f.work).save(
    owner,
    { base_revision: 2, value: { ...pref!.value, source_ids: null } },
    "batch-default-rules",
  );
  assert.ok(
    !(await f.recommendation.scope(owner)).sources.some(
      (s) => s.id === source.id,
    ),
  );
});
test("unreadable results stop after24 attempts and changed preference or cancellation prevents late result publication", async () => {
  const f = await setup(),
    created = await f.recommendation.create(
      owner,
      { scope_digest: f.scope.digest },
      "batch-unit-unreadable",
    );
  let bodies = 0;
  const runner = new ReadingWorkRunner(f.work, noModel, async (url) =>
    url.endsWith("/feed")
      ? { body: recommendationFeed(40), content_type: "application/rss+xml" }
      : (bodies++, { body: "short excerpt", content_type: "text/plain" }),
  );
  await runner.execute(owner, created.id);
  const ready = await f.work.read(owner, created.id);
  assert.equal(ready.status, "succeeded");
  assert.equal(bodies, 24);
  assert.equal(ready.output!.entry_refs!.length, 0);
  assert.equal(ready.output!.recommendation!.attempted, 24);
  assert.match(ready.output!.warnings!.at(-1)!, /0\/8/);
  const second = await setup(1),
    next = await second.recommendation.create(
      owner,
      { scope_digest: second.scope.digest },
      "batch-unit-cancel",
    );
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (reached = r)),
    wait = new Promise<void>((r) => (release = r));
  const late = new ReadingWorkRunner(second.work, noModel, async () => {
    reached();
    await wait;
    return { body: recommendationFeed(1), content_type: "application/rss+xml" };
  });
  const running = late.execute(owner, next.id);
  await entered;
  const active = await second.work.read(owner, next.id);
  await second.work.cancel(
    owner,
    next.id,
    { base_revision: active.revision },
    "batch-unit-cancel-original",
  );
  release();
  await running;
  const done = await second.work.read(owner, next.id);
  assert.equal(done.status, "cancelled");
  assert.equal(done.output, null);
  assert.equal((await second.work.assets(owner, next.id)).items.length, 0);
});

test("preference revisions revoke a running recommendation before any late archive or result can be saved", async () => {
  const f = await setup(1),
    created = await f.recommendation.create(
      owner,
      { scope_digest: f.scope.digest },
      "batch-unit-change-preferences",
    );
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (reached = r)),
    wait = new Promise<void>((r) => (release = r));
  const runner = new ReadingWorkRunner(f.work, noModel, async () => {
    reached();
    await wait;
    return { body: recommendationFeed(1), content_type: "application/rss+xml" };
  });
  const running = runner.execute(owner, created.id);
  await entered;
  const prefs = await f.work.store.preferences.get(owner);
  await new ReadingPreferencesService(f.work).save(
    owner,
    { base_revision: prefs!.revision, value: { ...prefs!.value, count: 2 } },
    "batch-unit-revoke-preferences",
  );
  release();
  await running;
  const done = await f.work.read(owner, created.id);
  assert.equal(done.status, "failed");
  assert.equal(done.error_code, "READING_CONTEXT_STALE");
  assert.equal(done.output, null);
  assert.equal((await f.work.assets(owner, created.id)).items.length, 0);
});
test("content and source commands reject PostgreSQL-incompatible text without replacing or accepting an in-memory-only fact", async () => {
  const f = await setup(1);
  await assert.rejects(
    f.work.saveSource(
      owner,
      "source-invalid-text",
      {
        base_revision: 0,
        title: "input\0remains local",
        url: "https://example.com/feed",
        format: "rss",
        archived: false,
      },
      "batch-unit-invalid-nul",
    ),
    { statusCode: 422 },
  );
  const { ReadingService } = await import(
    "../../src/modules/lighttick/reading/reading.service.ts"
  );
  await assert.rejects(
    new ReadingService(f.repo).write(
      owner,
      "article-invalid-text",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Original",
          body: "lone\uD800surrogate",
          source_url: null,
          language: "en",
          published_at: null,
        },
      },
      "batch-unit-invalid-surrogate",
    ),
    { statusCode: 422 },
  );
  assert.equal((await f.repo.reading.recommendationHistory(owner)).length, 0);
});

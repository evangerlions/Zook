import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("real PostgreSQL candidate metadata, original output digests and scoped full-text requests survive reconnect and owner cleanup", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    work = new ReadingWorkService(repo, new InMemoryJobQueue()),
    owner = {
      appId: "lighttick" as const,
      userId: "candidate-pg-" + process.pid,
    };
  try {
    const source = await work.saveSource(
        owner,
        "source-candidate-pg",
        {
          base_revision: 0,
          title: "PG source",
          url: "https://example.com/feed",
          format: "rss",
          archived: false,
          language: "en",
          topics: ["认知"],
          domains: ["example.com"],
        },
        "candidate-pg-source",
      ),
      created = await work.create(
        owner,
        { kind: "collect_source", source_id: source.id, base_revision: 1 },
        "candidate-pg-collect",
      );
    await new ReadingWorkRunner(
      work,
      {
        complete: async () => {
          throw Error("No model");
        },
      } as any,
      async () => ({
        body: "<rss><channel><item><title>Metadata only</title><link>https://example.com/article</link><author>Original author</author><pubDate>2016-12-14</pubDate></item></channel></rss>",
        content_type: "application/rss+xml",
      }),
    ).execute(owner, created.id);
    const fresh = new ReadingWorkService(
        new PostgresLightTickRepository(pool),
        new InMemoryJobQueue(),
      ),
      ready = await fresh.read(owner, created.id);
    assert.equal(ready.status, "succeeded");
    assert.equal(ready.output!.entries!.length, 0);
    const c = ready.output!.candidates![0],
      request = {
        kind: "collect_url",
        title: c.content.title,
        url: c.content.source_url,
        candidate: {
          work_id: ready.id,
          output_digest: ready.output_digest,
          candidate_id: c.id,
        },
      },
      child = await fresh.create(owner, request, "candidate-pg-fetch");
    assert.equal(child.scope.candidate_id, c.id);
    const stored = await fresh.store.get(owner, child.id);
    assert.equal(stored!.input.source_metadata!.author, "Original author");
    assert.equal(stored!.input.source_metadata!.published_at, null);
    assert.equal(stored!.input.source_metadata!.published_date, "2016-12-14");
    assert.deepEqual(
      await fresh.create(owner, request, "candidate-pg-fetch"),
      child,
    );
    await assert.rejects(
      fresh.create(
        { ...owner, userId: "other" },
        request,
        "candidate-pg-other-owner",
      ),
      { statusCode: 409 },
    );
  } finally {
    await repo.deleteOwnerData(owner);
    assert.equal((await work.list(owner)).items.length, 0);
    await pool.end();
  }
});

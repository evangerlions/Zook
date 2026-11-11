import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("reading source/work original receipts, AI drafts, atomic import, rollback and owner isolation survive actual PostgreSQL reconnect", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    queue = new InMemoryJobQueue(),
    o = {
      appId: "lighttick" as const,
      userId: "reading-work-pg-" + process.pid,
    };
  const make = () =>
    new ReadingWorkService(new PostgresLightTickRepository(pool), queue);
  const work = new ReadingWorkService(repo, queue),
    sourceBody = {
      base_revision: 0,
      title: "PG source",
      url: "https://example.com/a",
      format: "article",
      archived: false,
    };
  const llm = {
    complete: async () => ({
      text: "Synthetic provider output; no real model validation",
      provider: "synthetic",
      providerModel: "fixture",
    }),
  } as any;
  const fetch = async () => ({
    body: "<p>Original PG downloaded text</p>",
    content_type: "text/html",
  });
  try {
    const source = await work.saveSource(
      o,
      "source-pg-work",
      sourceBody,
      "pg-reading-source-original",
    );
    const edits = await Promise.allSettled([
      work.saveSource(
        o,
        source.id,
        { ...sourceBody, base_revision: 1, title: "One" },
        "pg-reading-source-one",
      ),
      work.saveSource(
        o,
        source.id,
        { ...sourceBody, base_revision: 1, title: "Two" },
        "pg-reading-source-two",
      ),
    ]);
    assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await make().sourceHistory(o, source.id)).items.length, 2);
    assert.deepEqual(
      await make().saveSource(
        o,
        source.id,
        sourceBody,
        "pg-reading-source-original",
      ),
      source,
    );
    await assert.rejects(
      make().source({ ...o, userId: "other-pg-owner" }, source.id),
      { statusCode: 404 },
    );
    const body = {
      kind: "collect_url",
      url: "https://example.com/a",
      title: "Owner PG article",
    };
    const created = await work.create(o, body, "pg-reading-create-original");
    const reconnected = make(),
      runner = new ReadingWorkRunner(reconnected, llm, fetch);
    await runner.recover();
    await runner.execute(o, created.id);
    const done = await reconnected.read(o, created.id);
    assert.equal(done.status, "succeeded");
    const b = {
        base_revision: done.revision,
        output_digest: done.output_digest,
        index: 0,
        base_article_revision: null,
      },
      save = repo.saveOperation.bind(repo);
    repo.saveOperation = async (row) => {
      if (row.action === "work:adopt")
        throw Error("receipt persistence failure");
      return save(row);
    };
    await assert.rejects(
      work.adopt(o, done.id, b, "pg-reading-adopt-original"),
      /receipt persistence failure/,
    );
    assert.equal(
      (
        await repo.reading.list(o, {
          after: "",
          filter: "all",
          search: "",
          limit: 20,
        })
      ).length,
      0,
    );
    assert.equal((await work.read(o, done.id)).revision, done.revision);
    repo.saveOperation = save;
    const adopted = await reconnected.adopt(
      o,
      done.id,
      b,
      "pg-reading-adopt-original",
    );
    assert.deepEqual(
      await make().adopt(o, done.id, b, "pg-reading-adopt-original"),
      adopted,
    );
    assert.equal(adopted.work.adopted["0"].article_id, adopted.article_id);
    const article = await new ReadingService(repo).read(o, adopted.article_id),
      ai = await reconnected.create(
        o,
        {
          kind: "summary",
          article_id: article.id,
          content_version: article.content_version,
          paragraph_id: null,
        },
        "pg-reading-ai-original",
      );
    await runner.execute(o, ai.id);
    const aiDone = await make().read(o, ai.id);
    const saved = await make().adopt(
      o,
      ai.id,
      {
        base_revision: aiDone.revision,
        output_digest: aiDone.output_digest,
        index: null,
        base_article_revision: article.revision,
      },
      "pg-reading-ai-draft-original",
    );
    const final = await new ReadingService(
      new PostgresLightTickRepository(pool),
    ).read(o, saved.article_id);
    assert.equal(final.materials![0].draft.origin, "ai");
    assert.equal(final.materials![0].adopted, null);
    assert.equal(final.personal.read, false);
    const exported = await new ReadingService(repo).export(o);
    assert.equal(exported.work.length, 2);
    assert.ok(exported.work[0].output);
    assert.equal(exported.sources.length, 1);
    assert.equal(exported.source_history[0].versions.length, 2);
    await runPostgresMigrations({ connectionString: dsn, log: () => {} });
    assert.equal((await make().list(o)).items.length, 2);
    await repo.deleteOwnerData(o);
    for (const table of [
      "reading_sources",
      "reading_source_versions",
      "reading_work",
    ]) {
      const result = await pool.query(
        "SELECT count(*)::int AS n FROM zook_lighttick_" +
          table +
          " WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      );
      assert.equal(result.rows[0].n, 0);
    }
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import {
  seedReadingRecommendation,
  recommendationFeed,
  recommendationText,
} from "../support/reading-recommendation-fixture.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("PostgreSQL batch assets retain exact NUL-containing bytes, reconnect, owner isolation, atomic adoption, original compact receipts, rollback and account cleanup", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "batch-pg-" + process.pid },
    clock = () => new Date("2026-11-12T02:00:00Z"),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      async () => {},
      clock,
    );
  try {
    const { recommendation, scope } = await seedReadingRecommendation(
        work,
        owner,
        3,
      ),
      created = await recommendation.create(
        owner,
        { scope_digest: scope.digest },
        "batch-pg-original",
      );
    await new ReadingWorkRunner(
      work,
      {
        complete: async () => {
          throw Error("No model");
        },
      } as any,
      async (url) =>
        url.endsWith("/feed")
          ? { body: recommendationFeed(6), content_type: "application/rss+xml" }
          : {
              body:
                "<article><!--\0--><p>" + recommendationText + "</p></article>",
              content_type: "text/html",
            },
    ).execute(owner, created.id);
    const fresh = new ReadingWorkService(
        new PostgresLightTickRepository(pool),
        new InMemoryJobQueue(),
        async () => {},
        clock,
      ),
      ready = await fresh.read(owner, created.id);
    assert.equal(ready.status, "succeeded");
    assert.equal(ready.output!.entry_refs!.length, 3);
    const ref = ready.output!.entry_refs![0],
      doc = await fresh.asset(owner, created.id, ref.document_id);
    assert.ok(Buffer.from((doc.value as any).body, "base64").includes(0));
    await assert.rejects(
      fresh.asset({ ...owner, userId: "other" }, created.id, ref.document_id),
      { statusCode: 404 },
    );
    const command = {
      base_revision: ready.revision,
      output_digest: ready.output_digest,
      index: 0,
      base_article_revision: null,
      response_view: "summary",
    };
    const saveOperation = fresh.repo.saveOperation.bind(fresh.repo);
    fresh.repo.saveOperation = async (row) => {
      if (row.operationId === "batch-pg-rollback")
        throw Error("Injected receipt storage failure");
      return saveOperation(row);
    };
    await assert.rejects(
      fresh.adopt(owner, created.id, command, "batch-pg-rollback"),
      /Injected/,
    );
    assert.equal((await repo.reading.recommendationHistory(owner)).length, 0);
    assert.equal(
      (await fresh.read(owner, created.id)).revision,
      ready.revision,
    );
    const saved = await fresh.adopt(
      owner,
      created.id,
      command,
      "batch-pg-adopt",
    );
    assert.equal("output" in saved.work, false);
    assert.deepEqual(
      await work.adopt(owner, created.id, command, "batch-pg-adopt"),
      saved,
    );
    const entries = await pool.query(
      "SELECT count(*)::int AS n FROM zook_lighttick_reading_work_assets WHERE app_id=$1 AND user_id=$2",
      [owner.appId, owner.userId],
    );
    assert.equal(entries.rows[0].n, 7);
  } finally {
    await repo.deleteOwnerData(owner);
    const rows = await pool.query(
      "SELECT count(*)::int AS n FROM zook_lighttick_reading_work_assets WHERE user_id=$1",
      [owner.userId],
    );
    assert.equal(rows.rows[0].n, 0);
    await pool.end();
  }
});

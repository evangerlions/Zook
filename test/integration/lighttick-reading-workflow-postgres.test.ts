import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { ReadingWorkflowService } from "../../src/modules/lighttick/reading/reading-workflow.service.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_reading_")
)
  throw Error("Disposable reading database required.");
test("PostgreSQL reading workflow: persisted collection save, concurrent scheduling, owner isolation, CAS, completion and rollback", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick", userId: "reading-" + randomUUID() },
    bob = { appId: "lighttick", userId: "reading-bob-" + randomUUID() };
  const clock = () => new Date("2026-11-14T10:00:00Z");
  const workflow = new ReadingWorkflowService(
    repo,
    async () =>
      "<rss><channel><item><title>Test article</title><link>https://example.com/reading</link><description>Summary only</description></item></channel></rss>",
    clock,
  );
  try {
    const source = await workflow.addSource(owner, {
      name: "Example",
      url: "https://example.com/feed",
      language: "en",
      topics: ["growth"],
    });
    const collection = await workflow.collect(owner, {
      request_key: "postgres-reading-" + randomUUID(),
      source_ids: [source.id],
    });
    const results = await Promise.all([
      workflow.saveCandidate(owner, collection.id, collection.candidates[0].id),
      workflow.saveCandidate(owner, collection.id, collection.candidates[0].id),
    ]);
    assert.equal(results[0].article.id, results[1].article.id);
    const articleId = results[0].article.id;
    assert.equal(results[0].article.body_kind, "none");
    const scheduled = await Promise.all(
      Array.from({ length: 5 }, () => workflow.schedule(owner, articleId)),
    );
    assert.equal(new Set(scheduled.map((t) => t.id)).size, 1);
    assert.equal((await workflow.tasks(owner)).items.length, 1);
    assert.equal((await workflow.tasks(bob)).items.length, 0);
    await assert.rejects(() => workflow.schedule(bob, articleId), {
      statusCode: 404,
    });
    await assert.rejects(
      () =>
        workflow.command(owner, scheduled[0].id, {
          base_version: 99,
          action: "complete",
        }),
      { statusCode: 409 },
    );
    const running = await workflow.command(owner, scheduled[0].id, {
      base_version: 1,
      action: "start",
    });
    assert.equal(running.status, "in_progress");
    await assert.rejects(
      repo.transaction(owner, async () => {
        await workflow.command(owner, running.id, {
          base_version: 2,
          action: "complete",
        });
        throw Error("rollback");
      }),
    );
    assert.equal(
      (await repo.getReadingState(owner, articleId))?.completedAt ?? null,
      null,
    );
    assert.equal((await workflow.tasks(owner)).items[0].status, "in_progress");
    const state = await repo.getReadingState(owner, articleId);
    await workflow.saveState(owner, articleId, {
      base_version: state?.revision ?? 0,
      position_ratio: 50,
      completed: true,
    });
    assert.equal((await workflow.tasks(owner)).items[0].status, "completed");
    assert.ok(
      (await new ReadingService(repo).detail(owner, articleId)).state
        .completed_at,
    );
    const reopened = new ReadingWorkflowService(
      new PostgresLightTickRepository(pool),
      undefined,
      clock,
    );
    assert.equal(
      (await reopened.history(owner)).items[0].candidates[0].saved_article_id,
      articleId,
    );
    const tomorrow = new ReadingWorkflowService(
      repo,
      undefined,
      () => new Date("2026-11-15T10:00:00Z"),
    );
    assert.equal((await tomorrow.tasks(owner)).items.length, 0);
    const second = await new ReadingService(repo, clock).create(owner, {
      url: "https://example.com/second",
      title: "Cancel keeps article",
    });
    const secondTask = await workflow.schedule(owner, second.article.id);
    await workflow.command(owner, secondTask.id, {
      base_version: 1,
      action: "cancel",
    });
    assert.equal(
      (await repo.getReadingState(owner, second.article.id))?.completedAt ??
        null,
      null,
    );
    const rescheduled = await workflow.schedule(owner, second.article.id);
    assert.equal(rescheduled.id, secondTask.id);
    assert.equal(rescheduled.revision, 3);
    assert.equal(rescheduled.status, "pending");
    await workflow.changeSource(owner, source.id, { base_version: 1 }, true);
    assert.equal((await workflow.history(owner)).items.length, 1);
  } finally {
    await repo.deleteOwnerData(owner);
    await repo.deleteOwnerData(bob);
    await pool.end();
  }
});

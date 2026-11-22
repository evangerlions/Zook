import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/independent-reading/reading-work.runner.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("actual PostgreSQL feedback, literal metadata search, source editions and original receipts survive reconnect and cleanup", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    s = new ReadingService(repo),
    o = {
      appId: "lighttick" as const,
      userId: "reading-semantics-pg-" + process.pid,
    };
  const fresh = () => new ReadingService(new PostgresLightTickRepository(pool));
  try {
    const root = await s.write(
      o,
      "article-semantics-pg",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Original".repeat(60),
          body: "Feed excerpt",
          source_url: "https://example.com/article",
          language: "en",
          published_at: null,
          published_date: "2016-12-14",
          translated_title: "译名唯一",
          publisher: "Publisher literal % _",
          topics: ["认知"],
          category: "classic",
          description: "Source summary",
        },
      },
      "semantics-pg-import",
    );
    const b = {
      base_revision: 1,
      content_version: root.content_version,
      base_feedback_revision: 0,
      feedback: {
        value: "insightful",
        difficulty: "hard",
        takeaway: "takeaway % _",
        question: "未决问题唯一",
        action: "应用想法唯一",
        tags: ["Feedback tag"],
      },
      mark_read: false,
    };
    const feedback = await s.write(
      o,
      root.id,
      "feedback",
      b,
      "semantics-pg-feedback",
    );
    assert.deepEqual(
      await fresh().write(o, root.id, "feedback", b, "semantics-pg-feedback"),
      feedback,
    );
    for (const search of [
      "译名唯一",
      "Publisher literal % _",
      "takeaway % _",
      "未决问题唯一",
      "应用想法唯一",
      "Feedback tag",
    ]) {
      assert.equal((await fresh().list(o, { search })).items.length, 1, search);
      assert.equal(
        (await fresh().list({ ...o, userId: "other" }, { search })).items
          .length,
        0,
      );
    }
    assert.equal(
      (await fresh().list(o, { filter: "feedback" })).items.length,
      1,
    );
    assert.equal(
      (await fresh().list(o, { search: "structured_feedback" })).items.length,
      0,
    );
    const work = new ReadingWorkService(repo, new InMemoryJobQueue()),
      job = await work.create(
        o,
        {
          kind: "fetch_full",
          article_id: root.id,
          content_version: root.content_version,
        },
        "semantics-pg-fulltext",
      ),
      runner = new ReadingWorkRunner(
        work,
        {
          complete: async () => {
            throw Error("unexpected model");
          },
        } as any,
        async () => ({
          body: "<p>Full source text with independently checkable arguments and examples.</p>".repeat(3),
          content_type: "text/html",
        }),
      );
    await runner.execute(o, job.id);
    const done = await work.read(o, job.id);
    assert.equal(done.status, "succeeded");
    const adopted = await work.adopt(
      o,
      done.id,
      {
        base_revision: done.revision,
        output_digest: done.output_digest,
        index: 0,
        base_article_revision: null,
      },
      "semantics-pg-adopt",
    );
    const child = await fresh().read(o, adopted.article_id);
    assert.equal(child.provenance!.root_article_id, root.id);
    assert.equal(child.content.published_date, "2016-12-14");
    assert.equal(child.personal.read, false);
    assert.equal(
      (await fresh().read(o, root.id)).personal.structured_feedback!.version,
      1,
    );
    assert.equal((await fresh().editions(o, child.id)).items.length, 2);
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("feedback receipt failure");
    };
    await assert.rejects(
      s.write(
        o,
        root.id,
        "feedback",
        { ...b, base_revision: 2, base_feedback_revision: 1, mark_read: true },
        "semantics-pg-rollback",
      ),
      /receipt failure/,
    );
    repo.saveOperation = save;
    assert.equal((await fresh().read(o, root.id)).personal.read, false);
    assert.equal((await fresh().history(o, root.id)).items.length, 2);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

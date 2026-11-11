import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
import { ReviewService } from "../../src/modules/lighttick/knowledge/review.service.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated local synthetic reading database required");
test("PostgreSQL article source references remain exact across private edits/archive/reconnect and global search projects actual full-tail/private/material matches", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString }),
    repo = new PostgresLightTickRepository(pool),
    reading = new ReadingService(repo),
    actions = new ActionService(
      repo,
      () => new Date("2026-11-12T02:00:00Z"),
      undefined,
      true,
    ),
    knowledge = new KnowledgeService(repo),
    review = new ReviewService(repo),
    owner = {
      appId: "lighttick",
      userId: "reading-source-pg-synthetic",
    } as const,
    other = { ...owner, userId: "reading-source-pg-other" };
  try {
    await repo.deleteOwnerData(owner);
    const article = await reading.write(
      owner,
      "article-source-pg-original",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Actual source",
          body: "🙂原文 ".repeat(45000) + "literal tail % _ evidence",
          language: "en",
          published_at: null,
          source_url: "https://reading.example.test/exact-original",
        },
      },
      "source-pg-import",
    );
    const input = {
      key: "source-pg-practice",
      source_kind: "article",
      source_id: article.id,
      source_version: article.content_version,
      title: "Apply original evidence",
      date: null,
    };
    const { plan } = (await actions.request(
      owner,
      "POST",
      "/practices",
      input,
    )) as any;
    const entry = await knowledge.mutate(
      owner,
      "knowledge-article-pg",
      "save",
      {
        base_revision: 0,
        kind: "knowledge",
        title: "Interpret original",
        body: "Separate own interpretation",
        tags: [],
        sources: [
          { kind: "article", id: article.id, version: article.content_version },
        ],
      },
      "source-pg-knowledge",
    );
    let result = await review.snapshot(owner, {
      q: "literal tail % _ evidence",
    });
    assert.equal(result.counts.article_saved, 1);
    assert.ok(result.items[0].excerpt.includes("literal tail % _ evidence"));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 5000);
    assert.equal((await review.snapshot(owner, { q: "%missing" })).total, 0);
    await reading.write(
      owner,
      article.id,
      "personal",
      {
        base_revision: 1,
        content_version: article.content_version,
        personal: {
          notes: "私人搜索上下文needle",
          feedback: "",
          read: true,
          later: false,
          bookmark: true,
        },
      },
      "source-pg-private",
    );
    await reading.write(
      owner,
      article.id,
      "draft",
      {
        base_revision: 2,
        content_version: article.content_version,
        kind: "summary",
        paragraph_id: null,
        text: "frozen draft-only material needle",
      },
      "source-pg-material",
    );
    result = await review.snapshot(owner, {
      q: "私人搜索上下文needle",
      limit: "1",
    });
    assert.equal(result.counts.article_saved, 1);
    assert.equal(result.counts.article_read, 1);
    assert.equal(result.counts.lesson_completed, 0);
    assert.ok(result.items[0].excerpt.includes("私人搜索上下文needle"));
    assert.equal(
      (await review.snapshot(owner, { q: "frozen draft-only material needle" }))
        .counts.article_saved,
      1,
    );
    assert.equal(
      (
        await review.snapshot(owner, {
          q: "https://reading.example.test/exact-original",
        })
      ).counts.article_saved,
      1,
    );
    assert.equal(
      (await review.snapshot(other, { q: "私人搜索上下文needle" })).total,
      0,
    );
    await reading.write(
      owner,
      article.id,
      "archive",
      { base_revision: 3 },
      "source-pg-archive",
    );
    const restarted = new ReviewService(new PostgresLightTickRepository(pool));
    assert.equal(
      (
        await restarted.source(owner, {
          kind: "article",
          id: article.id,
          version: article.content_version,
        })
      ).text,
      article.content.body,
    );
    assert.equal((await knowledge.read(owner, entry.id)).id, entry.id);
    assert.equal(
      (await review.snapshot(owner, { q: "Separate own interpretation" }))
        .counts.knowledge,
      1,
    );
    assert.equal(
      (
        (await actions.request(
          owner,
          "GET",
          "/practices/" + plan.id + "/source",
        )) as any
      ).text,
      article.content.body,
    );
    assert.deepEqual(
      await actions.request(owner, "POST", "/practices", input),
      { plan },
    );
    await assert.rejects(
      actions.request(owner, "POST", "/practices", {
        ...input,
        key: "source-pg-new-archived",
      }),
      { statusCode: 404 },
    );
    const workspace = await repo.getActionWorkspace(owner);
    assert.equal(workspace!.data.plans.length, 1);
    assert.ok(!JSON.stringify(workspace!.data).includes("literal tail"));
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { Client, Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
    !new URL(dsn).pathname.startsWith("/grow_web_u1_legacy_layout_")) {
  throw Error("A disposable legacy-layout database is required.");
}

test("the legacy Grow layout keeps article history and adapts course classifications during upgrade", async () => {
  const sql = new Client({ connectionString: dsn });
  const pool = new Pool({ connectionString: dsn });
  const owner = { appId: "lighttick" as const, userId: "preexisting-grow-owner" };
  const module = {
    ...owner, id: "module-old", title: "Earlier classification", description: "Original text",
    templateId: "thinking-tools", revision: 2, archived: true,
    createdAt: "2026-10-02T03:00:00.000Z", updatedAt: "2026-11-03T04:00:00.000Z",
  };
  const article = {
    id: "article-old", revision: 2, archived: false, content_version: "1".repeat(64),
    content: { title: "Existing pasted content", body: "Original text", source_url: null },
    personal: { read: true }, created_at: "2026-10-02T03:00:00.000Z",
  };
  await sql.connect();
  try {
    await sql.query(`
      CREATE TABLE zook_lighttick_learning_modules (
        app_id text, user_id text, id text, revision int NOT NULL, payload jsonb NOT NULL,
        PRIMARY KEY (app_id,user_id,id)
      );
      CREATE TABLE zook_lighttick_reading_articles (
        app_id text, user_id text, id text, revision int NOT NULL, payload jsonb NOT NULL,
        PRIMARY KEY (app_id,user_id,id)
      );
      CREATE TABLE zook_lighttick_reading_versions (
        app_id text, user_id text, id text, revision int NOT NULL, payload jsonb NOT NULL,
        PRIMARY KEY (app_id,user_id,id,revision),
        FOREIGN KEY (app_id,user_id,id) REFERENCES zook_lighttick_reading_articles(app_id,user_id,id)
      );
    `);
    const write = (table: string, row: { id: string; revision: number }) =>
      sql.query(`INSERT INTO ${table} VALUES($1,$2,$3,$4,$5::jsonb)`,
        [owner.appId, owner.userId, row.id, row.revision, JSON.stringify(row)]);
    await write("zook_lighttick_learning_modules", module);
    await write("zook_lighttick_reading_articles", article);
    await write("zook_lighttick_reading_versions", { ...article, revision: 1 });
    await write("zook_lighttick_reading_versions", article);

    await runPostgresMigrations({ connectionString: dsn, log: () => {} });
    const repo = new PostgresLightTickRepository(pool);
    assert.equal((await repo.independentReading.get(owner, article.id))?.content_version, article.content_version);
    const history = await repo.independentReading.history(owner, article.id, 100, 4);
    assert.deepEqual(history.map(row => row.revision), [2, 1]);
    assert.equal(await repo.getReadingArticle(owner, article.id), undefined);
    assert.equal((await repo.learningModules.get(owner, module.id))?.templateId, module.templateId);
    assert.equal((await repo.getLearningModule(owner, module.id))?.enabled, false);
    assert.equal((await repo.learningModules.history(owner, module.id, 99, 4))[0]?.createdAt, module.createdAt);

    await repo.transaction(owner, () => repo.learningModules.save({ ...module, title: "Renamed", revision: 3 }, 2));
    await runPostgresMigrations({ connectionString: dsn, log: () => {} });
    assert.equal((await repo.getLearningModule(owner, module.id))?.title, "Renamed");
    assert.equal((await repo.independentReading.history(owner, article.id, 100, 4)).length, 2);
  } finally {
    await pool.end();
    await sql.end();
  }
});

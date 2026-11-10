import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !/^lighttick_full_migration_[0-9]+$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated lighttick_full_migration_<date> database required.");
test("reading PG migrations, literal search, CAS, rollback, restart and owner deletion", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString });
  const owner = { appId: "lighttick", userId: "reading-pg-synthetic" } as const;
  const other = { appId: "lighttick", userId: "reading-pg-other" } as const;
  const repo = new PostgresLightTickRepository(pool);
  const s = new ReadingService(repo);
  const id = "article-pg-synthetic";
  const body = {
    base_revision: 0,
    content: {
      title: "Literal % _",
      body: "原文\n  exact bytes ",
      source_url: null,
      language: "zh",
      published_at: null,
    },
  };
  try {
    await repo.deleteOwnerData(owner);
    await repo.deleteOwnerData(other);
    const imported = await s.write(
      owner,
      id,
      "import",
      body,
      "reading-pg-original",
    );
    assert.equal((await s.list(owner, { search: "% _" })).items.length, 1);
    assert.equal((await s.list(owner, { search: "%missing" })).items.length, 0);
    assert.equal((await s.list(other)).items.length, 0);
    const command = {
      base_revision: 1,
      content_version: imported.content_version,
      personal: {
        notes: "保存笔记",
        feedback: "",
        bookmark: true,
        later: false,
        read: false,
      },
    };
    const result = await Promise.allSettled([
      s.write(owner, id, "personal", command, "reading-pg-first"),
      s.write(
        owner,
        id,
        "personal",
        { ...command, personal: { ...command.personal, notes: "competing" } },
        "reading-pg-second",
      ),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await s.history(owner, id)).items.length, 2);
    assert.deepEqual(
      await s.write(owner, id, "import", body, "reading-pg-original"),
      imported,
    );
    await assert.rejects(
      repo.transaction(owner, async () => {
        await s.write(
          owner,
          "article-pg-rollback",
          "import",
          body,
          "reading-pg-rollback",
        );
        throw Error("force rollback");
      }),
      /force rollback/,
    );
    await assert.rejects(s.read(owner, "article-pg-rollback"), {
      statusCode: 404,
    });
    const restarted = new ReadingService(new PostgresLightTickRepository(pool));
    assert.equal(
      (await restarted.export(owner)).sha256,
      (await s.export(owner)).sha256,
    );
    const snapshot = await restarted.read(owner, id);
    await s.write(
      owner,
      id,
      "archive",
      { base_revision: snapshot.revision },
      "reading-pg-archive",
    );
    assert.equal((await s.list(owner)).items.length, 0);
    assert.equal((await s.list(owner, { filter: "archived" })).items.length, 1);
    await repo.deleteOwnerData(owner);
    assert.equal((await s.list(owner, { filter: "archived" })).items.length, 0);
    await assert.rejects(s.receipt(owner, "reading-pg-original"), {
      statusCode: 404,
    });
  } finally {
    await pool.end();
  }
});

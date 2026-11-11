import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import {
  exerciseReadingImport,
  readingImportOwner,
} from "../support/reading-import-acceptance.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated localhost synthetic reading database required");
test("PostgreSQL reviewed import roots/exact receipts/erasure and derived index rebuild roll back and concurrent stale scopes cannot create duplicates", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString }),
    repo = new PostgresLightTickRepository(pool),
    o = readingImportOwner;
  const count = async () =>
    Number(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_reading_import_index WHERE app_id=$1 AND user_id=$2",
          [o.appId, o.userId],
        )
      ).rows[0].n,
    );
  try {
    await repo.deleteOwnerData(o);
    const result = await exerciseReadingImport(repo),
      service = new ReadingService(new PostgresLightTickRepository(pool));
    assert.equal(await count(), 4);
    const originalPayloads = await pool.query(
      "SELECT id,revision,payload FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 ORDER BY id",
      [o.appId, o.userId],
    );
    await pool.query(
      "DELETE FROM zook_lighttick_reading_import_index WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );
    await assert.rejects(
      repo.transaction(o, async () => {
        await new ReadingService(repo).previewImport(o, {
          content: result.existing.content,
        });
        throw Error("synthetic index rollback");
      }),
      /synthetic index rollback/,
    );
    assert.equal(await count(), 0);
    const scope = await service.previewImport(o, {
      content: result.existing.content,
    });
    assert.equal(await count(), 4);
    assert.deepEqual(
      (
        await pool.query(
          "SELECT id,revision,payload FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 ORDER BY id",
          [o.appId, o.userId],
        )
      ).rows,
      originalPayloads.rows,
    );
    const body = {
      base_revision: 0,
      content: result.existing.content,
      import_decision: {
        scope_digest: scope.digest,
        mode: "independent",
        article_id: null,
      },
    };
    const race = await Promise.allSettled(
      ["one", "two"].map((suffix) =>
        new ReadingService(new PostgresLightTickRepository(pool)).write(
          o,
          "article-import-race-" + suffix,
          "import",
          body,
          "reading-import-race-" + suffix,
        ),
      ),
    );
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      race.filter((r) => r.status === "rejected" && r.reason.statusCode === 409)
        .length,
      1,
    );
    const winner =
      race.findIndex((r) => r.status === "fulfilled") === 0 ? "one" : "two";
    const replay = await service.write(
      o,
      "article-import-race-" + winner,
      "import",
      body,
      "reading-import-race-" + winner,
    );
    assert.equal(replay.revision, 1);
    assert.equal(await count(), 5);
    await repo.deleteOwnerData(o);
    assert.equal(await count(), 0);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

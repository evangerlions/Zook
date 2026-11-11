import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingPreferencesService } from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("isolated PostgreSQL preferences, source fields/tombstones and immutable original requests survive reconnect, rollback and account deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = { appId: "lighttick" as const, userId: "prefs-pg-" + process.pid },
    work = new ReadingWorkService(repo, new InMemoryJobQueue()),
    prefs = new ReadingPreferencesService(work),
    fresh = () =>
      new ReadingPreferencesService(
        new ReadingWorkService(
          new PostgresLightTickRepository(pool),
          new InMemoryJobQueue(),
        ),
      );
  try {
    const value = (await prefs.read(owner)).value,
      request = {
        base_revision: 0,
        value: {
          ...value,
          enabled: true,
          hour: 23,
          minute: 59,
          count: 8,
          auto_guide: true,
        },
      },
      saved = await prefs.save(owner, request, "prefs-pg-original");
    await prefs.save(
      owner,
      {
        ...request,
        base_revision: 1,
        value: { ...request.value, query: "Changed" },
      },
      "prefs-pg-update",
    );
    assert.deepEqual(
      await fresh().save(owner, request, "prefs-pg-original"),
      saved,
    );
    assert.equal((await fresh().read(owner)).revision, 2);
    assert.equal(
      (await fresh().read({ ...owner, userId: "other-owner" })).revision,
      0,
    );
    const source = await work.saveSource(
      owner,
      "source-prefs-pg",
      {
        base_revision: 0,
        title: "Personal source",
        url: "https://example.com/feed",
        format: "rss",
        archived: false,
        language: "en",
        topics: ["认知"],
        domains: ["example.com", "www.example.com"],
        catalog_id: null,
      },
      "prefs-pg-source",
    );
    await work.deleteSource(
      owner,
      source.id,
      { base_revision: 1 },
      "prefs-pg-delete",
    );
    assert.equal((await work.sources(owner)).items.length, 0);
    const exported = await new ReadingService(
      new PostgresLightTickRepository(pool),
    ).export(owner);
    assert.equal(exported.preferences!.revision, 2);
    assert.equal(exported.preferences_history.length, 2);
    assert.ok(exported.sources[0].deleted_at);
    assert.equal(exported.source_history[0].versions[1].language, "en");
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("receipt unavailable");
    };
    await assert.rejects(
      prefs.save(owner, { ...request, base_revision: 2 }, "prefs-pg-rollback"),
      /receipt unavailable/,
    );
    repo.saveOperation = save;
    assert.equal((await fresh().history(owner)).items.length, 2);
    assert.equal((await fresh().read(owner)).revision, 2);
  } finally {
    await repo.deleteOwnerData(owner);
    assert.equal((await prefs.read(owner)).revision, 0);
    assert.equal((await prefs.history(owner)).items.length, 0);
    await pool.end();
  }
});

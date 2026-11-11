import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { readingCatalogEntry } from "../../src/modules/lighttick/reading/reading-article-projection.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated local synthetic reading database required");
test("PostgreSQL catalog projects Unicode previews before transfer, searches full body/material/private facts and retains exact detail/history after restart", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString }),
    repo = new PostgresLightTickRepository(pool),
    s = new ReadingService(repo),
    owner = {
      appId: "lighttick",
      userId: "reading-catalog-pg-synthetic",
    } as const;
  try {
    await repo.deleteOwnerData(owner);
    const body = "🙂".repeat(160) + " full hidden body % _ ".repeat(20000);
    let row = await s.write(
      owner,
      "article-catalog-pg-one",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Bounded catalog",
          body,
          source_url: null,
          language: "en",
          published_at: null,
        },
      },
      "catalog-pg-import-original",
    );
    row = await s.write(
      owner,
      row.id,
      "personal",
      {
        base_revision: row.revision,
        content_version: row.content_version,
        personal: {
          notes: "private catalog needle",
          feedback: "",
          read: false,
          later: true,
          bookmark: false,
        },
      },
      "catalog-pg-private-original",
    );
    row = await s.write(
      owner,
      row.id,
      "feedback",
      {
        base_revision: row.revision,
        content_version: row.content_version,
        base_feedback_revision: 0,
        feedback: {
          value: "",
          difficulty: "",
          takeaway: "structured feedback needle",
          question: "",
          action: "",
          tags: [],
        },
        mark_read: false,
      },
      "catalog-pg-feedback-original",
    );
    row = await s.write(
      owner,
      row.id,
      "draft",
      {
        base_revision: row.revision,
        content_version: row.content_version,
        kind: "summary",
        paragraph_id: null,
        text: "saved material needle",
      },
      "catalog-pg-material-original",
    );
    const expected = readingCatalogEntry(row);
    for (const search of [
      "private catalog needle",
      "structured feedback needle",
      "saved material needle",
      "full hidden body % _",
    ]) {
      const page = await s.catalog(owner, { search, filter: "feedback" });
      assert.deepEqual(page.items, [expected]);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 2000);
    }
    assert.equal(
      (await s.catalog(owner, { search: "%missing" })).items.length,
      0,
    );
    const restarted = new ReadingService(new PostgresLightTickRepository(pool));
    assert.deepEqual((await restarted.catalog(owner)).items, [expected]);
    assert.equal((await restarted.read(owner, row.id)).content.body, body);
    assert.equal((await restarted.history(owner, row.id)).items.length, 4);
    assert.equal(
      (await s.catalog({ ...owner, userId: "another-catalog-owner" })).items
        .length,
      0,
    );
    await repo.deleteOwnerData(owner);
    assert.equal((await restarted.catalog(owner)).items.length, 0);
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { VocabularyService } from "../../src/modules/lighttick/independent-reading/vocabulary.service.ts";
import { ReadingBackupService } from "../../src/modules/lighttick/independent-reading/reading-backup.service.ts";
import { seedReadingRecommendation } from "../support/reading-recommendation-fixture.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
const connectionString = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !connectionString ||
  !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(connectionString).pathname.slice(1),
  )
)
  throw Error("Dedicated local synthetic reading database required");
test("PostgreSQL complete backup preserves all12 reading datasets, >8MiB binary input and unresolved/terminal receipts across reconnect, rollback and owner cleanup", async () => {
  await runPostgresMigrations({ connectionString, log: () => {} });
  const pool = new Pool({ connectionString }),
    repo = new PostgresLightTickRepository(pool),
    owner = {
      appId: "lighttick",
      userId: "reading-backup-pg-synthetic",
    } as const,
    clock = () => new Date("2026-11-12T02:00:00Z"),
    work = new ReadingWorkService(
      repo,
      new InMemoryJobQueue(),
      async () => {},
      clock,
    ),
    reading = new ReadingService(repo),
    vocabulary = new VocabularyService(repo),
    backups = new ReadingBackupService(repo, async () => {}, clock);
  try {
    await repo.deleteOwnerData(owner);
    await seedReadingRecommendation(work, owner, 1);
    const row = await reading.write(
      owner,
      "article-backup-pg-original",
      "import",
      {
        base_revision: 0,
        content: {
          title: "Portable original",
          body: "🙂\n original bytes  ",
          source_url: null,
          language: "en",
          published_at: null,
        },
      },
      "backup-pg-import",
    );
    await reading.write(
      owner,
      row.id,
      "personal",
      {
        base_revision: 1,
        content_version: row.content_version,
        personal: {
          notes: "unknown publication date preserved",
          read: false,
          bookmark: true,
          later: false,
          feedback: "",
        },
      },
      "backup-pg-notes",
    );
    const word = {
      base_revision: 0,
      word: "portable",
      article_id: row.id,
      source_version: row.content_version,
    };
    await vocabulary.write(
      owner,
      "vocab-backup-pg-word",
      "add",
      word,
      "backup-pg-word",
    );
    await vocabulary.write(
      owner,
      "vocab-backup-pg-word",
      "review",
      { base_revision: 1, feedback: "good" },
      "backup-pg-review",
    );
    await vocabulary.write(
      owner,
      "vocab-backup-pg-deleted",
      "add",
      { ...word, word: "deleted" },
      "backup-pg-deleted-word",
    );
    await vocabulary.write(
      owner,
      "vocab-backup-pg-deleted",
      "delete",
      { base_revision: 1 },
      "backup-pg-delete-word",
    );
    const task = await work.create(
      owner,
      {
        kind: "collect_url",
        title: "Pending original input",
        url: "https://example.com/pending",
      },
      "backup-pg-pending-original",
    );
    const bytes = Buffer.alloc(7 * 1024 * 1024, 23);
    bytes[0] = 0;
    bytes[bytes.length - 1] = 255;
    const value = {
      body: bytes.toString("base64"),
      encoding: "base64" as const,
      content_type: "application/pdf",
      url: "https://example.com/pending",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      capture_kind: "pdf_text",
    };
    const hash = digest(value);
    await repo.transaction(owner, async () => {
      await repo.readingWork.assets.save(owner, {
        id: "readasset-" + digest(["document", hash]),
        work_id: task.id,
        sha256: hash,
        kind: "document",
        value,
      });
      await repo.readingWork.schedule.save(
        owner,
        {
          date: "2026-11-12",
          revision: 1,
          preferences_revision: 1,
          goal: 1,
          attempts: 1,
          phase: "pending",
          work_id: task.id,
          work_ids: [task.id],
          adopted: [],
          skipped: [],
          next_at: clock().toISOString(),
          error_code: null,
          created_at: clock().toISOString(),
          updated_at: clock().toISOString(),
        },
        0,
      );
    });
    await assert.rejects(reading.export(owner), { statusCode: 413 });
    const original = repo.saveOperation.bind(repo);
    repo.saveOperation = async (row) => {
      if (row.operationId === "backup-pg-rollback")
        throw Error("receipt rollback");
      return original(row);
    };
    await assert.rejects(
      backups.create(
        owner,
        { format: "lighttick-reading-ndjson-v2" },
        "backup-pg-rollback",
      ),
      /receipt rollback/,
    );
    assert.equal((await backups.list(owner)).items.length, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_reading_backup_parts WHERE user_id=$1",
          [owner.userId],
        )
      ).rows[0].n,
      0,
    );
    repo.saveOperation = original;
    const manifest = await backups.create(
      owner,
      { format: "lighttick-reading-ndjson-v2" },
      "backup-pg-create-original",
    );
    assert.ok(manifest.byte_length > 8 * 1024 * 1024);
    assert.equal(Object.keys(manifest.counts).length, 12);
    for (const count of Object.values(manifest.counts)) assert.ok(count > 0);
    await work.cancel(
      owner,
      task.id,
      { base_revision: task.revision },
      "backup-pg-cancel-after-capture",
    );
    const restarted = new ReadingBackupService(
      new PostgresLightTickRepository(pool),
      async () => {},
      clock,
    );
    assert.deepEqual(
      await restarted.receipt(owner, "backup-pg-create-original"),
      manifest,
    );
    const parts = [];
    for (const expected of manifest.parts) {
      const actual = await restarted.part(owner, manifest.id, expected.index),
        raw = Buffer.from(actual.data_base64, "base64");
      assert.equal(
        createHash("sha256").update(raw).digest("hex"),
        expected.sha256,
      );
      parts.push(raw);
    }
    const stream = Buffer.concat(parts);
    assert.equal(stream.length, manifest.byte_length);
    assert.equal(
      createHash("sha256").update(stream).digest("hex"),
      manifest.content_sha256,
    );
    const records = stream
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(records.length, manifest.record_count);
    assert.equal(
      records.find((r) => r.section === "work").value.status,
      "queued",
    );
    assert.ok(
      !Object.hasOwn(records.find((r) => r.section === "work").value, "fence"),
    );
    assert.equal(
      records.find(
        (r) =>
          r.section === "vocabulary" && r.key === "vocab-backup-pg-deleted",
      ).value,
      null,
    );
    assert.deepEqual(
      Buffer.from(
        records.find((r) => r.section === "work_assets").value.value.body,
        "base64",
      ),
      bytes,
    );
    assert.equal(
      records.filter((r) => r.section === "article_versions").length,
      2,
    );
    await assert.rejects(
      restarted.part(
        { ...owner, userId: "another-backup-owner" },
        manifest.id,
        0,
      ),
      { statusCode: 404 },
    );
    await repo.deleteOwnerData(owner);
    assert.equal((await restarted.list(owner)).items.length, 0);
    await assert.rejects(
      restarted.receipt(owner, "backup-pg-create-original"),
      { statusCode: 404 },
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_reading_backup_parts WHERE user_id=$1",
          [owner.userId],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

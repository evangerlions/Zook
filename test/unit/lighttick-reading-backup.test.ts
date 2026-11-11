import { pruneExpiredReadingBackups } from "../../src/modules/lighttick/reading/reading-backup-retention.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
import { ReadingBackupService } from "../../src/modules/lighttick/reading/reading-backup.service.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
const owner = { appId: "lighttick", userId: "reading-backup-unit" } as const,
  other = { ...owner, userId: "reading-backup-other" };
const body = { format: "lighttick-reading-ndjson-v2" };
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    s = new ReadingService(repo);
  const row = await s.write(
    owner,
    "article-backup-original",
    "import",
    {
      base_revision: 0,
      content: {
        title: "原文备份",
        body: "🙂\n".repeat(140000),
        source_url: null,
        language: "zh",
        published_at: null,
      },
    },
    "backup-import-original",
  );
  let now = new Date("2026-11-12T01:00:00Z");
  const backups = new ReadingBackupService(
    repo,
    async () => {},
    () => now,
  );
  return {
    repo,
    s,
    row,
    backups,
    setNow: (v: string) => {
      now = new Date(v);
    },
  };
}
test("byte-paged backups freeze exact text, history, relationships and original receipts; new writes do not change an accepted capture", async () => {
  const f = await setup(),
    manifest = await f.backups.create(owner, body, "backup-create-original");
  assert.ok(manifest.parts.length > 1);
  const { manifest_sha256, ...rest } = manifest;
  assert.equal(digest(rest), manifest_sha256);
  await f.s.write(
    owner,
    f.row.id,
    "personal",
    {
      base_revision: 1,
      content_version: f.row.content_version,
      personal: {
        notes: "new private fact",
        feedback: "",
        read: false,
        bookmark: true,
        later: false,
      },
    },
    "backup-personal-after-capture",
  );
  const chunks = [];
  for (const expected of manifest.parts) {
    const part = await f.backups.part(owner, manifest.id, expected.index),
      bytes = Buffer.from(part.data_base64, "base64");
    assert.equal(bytes.length, expected.byte_length);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expected.sha256,
    );
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, manifest.byte_length);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.content_sha256,
  );
  const records = bytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    records.filter((r) => r.section === "articles")[0].value.content.body,
    f.row.content.body,
  );
  assert.equal(
    records.filter((r) => r.section === "articles")[0].value.personal.notes,
    "",
  );
  assert.equal(
    records.filter((r) => r.section === "article_versions").length,
    1,
  );
  assert.equal(
    records.filter((r) => r.section === "receipts")[0].value.operationId,
    "backup-import-original",
  );
  assert.ok(
    !records.some(
      (r) =>
        r.section === "receipts" && r.value.entityType === "reading_backup",
    ),
  );
  assert.deepEqual(
    await f.backups.create(owner, body, "backup-create-original"),
    manifest,
  );
  assert.deepEqual(
    await f.backups.receipt(owner, "backup-create-original"),
    manifest,
  );
  assert.equal((await f.backups.list(owner)).items.length, 1);
  await assert.rejects(f.backups.part(other, manifest.id, 0), {
    statusCode: 404,
  });
  const second = await f.backups.create(owner, body, "backup-create-second");
  assert.notEqual(second.content_sha256, manifest.content_sha256);
  await assert.rejects(
    f.backups.create(owner, body, "backup-create-capacity"),
    { statusCode: 429 },
  );
  const deleted = await f.backups.delete(
    owner,
    manifest.id,
    { base_revision: 1 },
    "backup-delete-original",
  );
  assert.equal(deleted.deleted, true);
  assert.deepEqual(
    await f.backups.delete(
      owner,
      manifest.id,
      { base_revision: 1 },
      "backup-delete-original",
    ),
    deleted,
  );
  await assert.rejects(f.backups.part(owner, manifest.id, 0), {
    statusCode: 404,
  });
  assert.deepEqual(
    await f.backups.create(owner, body, "backup-create-original"),
    manifest,
  );
  assert.equal((await f.backups.list(owner)).items.length, 1);
  f.setNow("2026-11-13T01:00:01Z");
  await assert.rejects(f.backups.part(owner, second.id, 0), {
    statusCode: 410,
  });
  assert.deepEqual(
    await f.backups.receipt(owner, "backup-create-second"),
    second,
  );
  assert.deepEqual(
    await pruneExpiredReadingBackups(f.repo, "2026-11-13T01:00:01Z"),
    { checked: 1, failed: 0 },
  );
  assert.equal((await f.backups.list(owner)).items.length, 0);
  assert.deepEqual(
    await f.backups.receipt(owner, "backup-create-second"),
    second,
  );
  const fresh = await f.backups.create(
    owner,
    body,
    "backup-create-after-expiry",
  );
  assert.equal((await f.backups.list(owner)).items.length, 1);
  assert.notEqual(fresh.id, second.id);
});
test("capture failure or receipt failure commits no partial snapshot, authority is rechecked and original intent cannot change", async () => {
  const f = await setup(),
    original = f.repo.saveOperation.bind(f.repo);
  f.repo.saveOperation = async (r) => {
    if (r.entityType === "reading_backup") throw Error("receipt rollback");
    return original(r);
  };
  await assert.rejects(
    f.backups.create(owner, body, "backup-failure-original"),
    /receipt rollback/,
  );
  assert.equal((await f.backups.list(owner)).items.length, 0);
  f.repo.saveOperation = original;
  const first = await f.backups.create(owner, body, "backup-failure-original");
  assert.ok(first);
  await assert.rejects(
    f.backups.create(owner, { format: "changed" }, "backup-failure-original"),
    { statusCode: 422 },
  );
  const denied = new ReadingBackupService(f.repo, async () => {
    throw Error("owner revoked");
  });
  await assert.rejects(denied.part(owner, first.id, 0), /owner revoked/);
  await f.repo.deleteOwnerData(owner);
  assert.equal((await f.backups.list(owner)).items.length, 0);
  await assert.rejects(f.backups.receipt(owner, "backup-failure-original"), {
    statusCode: 404,
  });
});

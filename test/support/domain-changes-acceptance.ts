import assert from "node:assert/strict";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import { DomainChangesService } from "../../src/modules/lighttick/domain-changes/domain-changes.service.ts";
import { ReadingService } from "../../src/modules/lighttick/independent-reading/reading.service.ts";
import { ReadingBackupService } from "../../src/modules/lighttick/independent-reading/reading-backup.service.ts";
export const domainChangesOwner = {
  appId: "lighttick",
  userId: "domain-changes-synthetic",
} as const;
export async function exerciseDomainChanges(repo: LightTickRepository) {
  const o = domainChangesOwner,
    other = { ...o, userId: o.userId + "-other" },
    s = new DomainChangesService(repo),
    reading = new ReadingService(repo);
  const start = await s.read(o, { domain: "reading", start: "latest" });
  const body = {
    base_revision: 0,
    content: {
      title: "Private source title",
      body: "Secret original source 🙂",
      source_url: null,
      language: "en",
      published_at: null,
    },
  };
  const row = await reading.write(
    o,
    "article-domain-original",
    "import",
    body,
    "domain-original-import",
  );
  assert.deepEqual(
    await reading.write(o, row.id, "import", body, "domain-original-import"),
    row,
  );
  let page = await s.read(o, { domain: "reading", cursor: start.next_cursor });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].revision, 1);
  assert.equal(page.items[0].resource, "article");
  assert.deepEqual(Object.keys(page.items[0]).sort(), [
    "domain",
    "id",
    "notified_at",
    "operation",
    "resource",
    "revision",
    "sequence",
  ]);
  assert.ok(!JSON.stringify(page).includes("Secret"));
  assert.match(page.items[0].sequence, /^[1-9][0-9]*$/);
  assert.ok(Number.isFinite(Date.parse(page.items[0].notified_at)));
  const personal = {
    base_revision: 1,
    content_version: row.content_version,
    personal: {
      notes: "Private notes must never be copied to notification log",
      feedback: "",
      read: false,
      bookmark: false,
      later: false,
    },
  };
  await assert.rejects(
    repo.transaction(o, async () => {
      await reading.write(
        o,
        row.id,
        "personal",
        personal,
        "domain-rollback-personal",
      );
      throw Error("synthetic rollback");
    }),
    /synthetic rollback/,
  );
  assert.equal(
    (await s.read(o, { domain: "reading", cursor: page.next_cursor })).items
      .length,
    0,
  );
  assert.equal((await reading.read(o, row.id)).revision, 1);
  assert.equal(
    await repo.getOperation(o, "domain-rollback-personal"),
    undefined,
  );
  await reading.write(
    o,
    row.id,
    "personal",
    personal,
    "domain-committed-personal",
  );
  await repo.transaction(o, async () => {
    await repo.domainChanges.append(o, {
      domain: "reading",
      resource: "article",
      id: row.id,
      revision: 2,
      operation: "upsert",
    });
  });
  page = await s.read(o, {
    domain: "reading",
    cursor: start.next_cursor,
    limit: "1",
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.has_more, true);
  const tail = await s.read(o, {
    domain: "reading",
    cursor: page.next_cursor,
    limit: "1",
  });
  assert.equal(tail.items.length, 1);
  assert.equal(tail.items[0].revision, 2);
  assert.equal(tail.has_more, false);
  const empty = await s.read(o, {
    domain: "reading",
    cursor: tail.next_cursor,
  });
  assert.deepEqual(empty, {
    items: [],
    next_cursor: tail.next_cursor,
    has_more: false,
  });
  await assert.rejects(
    s.read(other, { domain: "reading", cursor: tail.next_cursor }),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.read(o, { domain: "knowledge", cursor: tail.next_cursor }),
    { statusCode: 409 },
  );
  assert.equal((await s.read(other)).items.length, 0);
  assert.equal((await s.read(o, { domain: "knowledge" })).items.length, 0);
  const backup = new ReadingBackupService(repo),
    manifest = await backup.create(
      o,
      { format: "lighttick-reading-ndjson-v2" },
      "domain-backup-create",
    );
  await repo.transaction(o, () => repo.readingBackups.delete(o, manifest.id));
  const backupEvents = (
    await s.read(o, { domain: "reading", cursor: tail.next_cursor })
  ).items.filter((r) => r.resource === "backup");
  assert.deepEqual(
    backupEvents.map((r) => [r.operation, r.revision]),
    [
      ["upsert", 1],
      ["delete", 1],
    ],
  );
  assert.deepEqual(await repo.pullChanges(o, 0, 100), []);
  return { row, cursor: tail.next_cursor, service: s };
}

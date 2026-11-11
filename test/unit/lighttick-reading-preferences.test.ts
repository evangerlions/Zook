import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import {
  ReadingPreferencesService,
  normalizeReadingPreferences,
} from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import { ReadingService } from "../../src/modules/lighttick/reading/reading.service.ts";
const o = { appId: "lighttick" as const, userId: "reading-prefs-owner" };
const source = {
  base_revision: 0,
  title: "Personal source",
  url: "https://example.com/feed",
  format: "rss",
  archived: false,
  language: "en",
  topics: ["认知", "成长"],
  domains: ["example.com", "WWW.example.com"],
  catalog_id: null,
};
function setup() {
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  let allowed = true;
  const work = new ReadingWorkService(repo, queue, async () => {
      if (!allowed) throw Object.assign(Error("revoked"), { statusCode: 403 });
    }),
    prefs = new ReadingPreferencesService(work);
  return { repo, queue, work, prefs, revoke: () => (allowed = false) };
}
test("all legacy preferences, public catalogue references and original CAS receipts remain owner-scoped without creating personal projects or paid work", async () => {
  const f = setup(),
    initial = await f.prefs.setup(o);
  assert.equal(initial.preferences.revision, 0);
  assert.equal(initial.preferences.value.enabled, false);
  assert.equal(await f.repo.readingWork.preferences.get(o), undefined);
  assert.equal(initial.default_sources.length, 10);
  assert.equal(initial.classics.length, 4);
  assert.equal(
    initial.catalogue_verification,
    "legacy_reference_not_live_verified",
  );
  assert.equal(initial.classics[0].published_date, "2016-12-14");
  assert.equal(initial.classics[0].published_at, null);
  assert.equal(initial.topics.length, 6);
  const sourceRow = await f.work.saveSource(
      o,
      "source-prefs-custom",
      source,
      "preferences-source-original",
    ),
    request = {
      base_revision: 0,
      value: {
        ...initial.preferences.value,
        enabled: true,
        hour: 23,
        minute: 59,
        count: 8,
        mode: "classic",
        topics: ["认知", "心理"],
        languages: ["zh", "en"],
        query: "关键 literal",
        auto_guide: true,
        source_ids: [sourceRow.id],
      },
    };
  const saved = await f.prefs.save(o, request, "preferences-original-save");
  assert.equal(saved.value.count, 8);
  assert.equal(saved.value.auto_guide, true);
  assert.deepEqual(saved.value.source_ids, [sourceRow.id]);
  await f.prefs.save(
    o,
    {
      ...request,
      base_revision: 1,
      value: { ...request.value, query: "Changed" },
    },
    "preferences-second-save",
  );
  assert.deepEqual(
    await f.prefs.save(o, request, "preferences-original-save"),
    saved,
  );
  assert.equal((await f.prefs.history(o)).items.length, 2);
  assert.equal((await f.prefs.read({ ...o, userId: "other" })).revision, 0);
  await assert.rejects(
    f.prefs.save(
      o,
      { ...request, value: { ...request.value, query: "Changed intent" } },
      "preferences-original-save",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    f.prefs.save(o, { ...request, base_revision: 1 }, "preferences-stale-key"),
    { statusCode: 409 },
  );
  const exported = await new ReadingService(f.repo).export(o);
  assert.equal(exported.preferences!.revision, 2);
  assert.equal(exported.preferences_history.length, 2);
  assert.equal(f.queue.jobs.length, 0);
  f.revoke();
  await assert.rejects(f.prefs.save(o, request, "preferences-original-save"), {
    statusCode: 403,
  });
  await f.repo.deleteOwnerData(o);
  assert.equal(await f.repo.readingWork.preferences.get(o), undefined);
});
test("personal source fields, allowed domains, deleted configuration and immutable history survive without reusing the deleted identity", async () => {
  const f = setup(),
    created = await f.work.saveSource(
      o,
      "source-custom-fields",
      source,
      "source-fields-original",
    );
  assert.deepEqual(created.topics, source.topics);
  assert.deepEqual(created.domains, ["example.com", "www.example.com"]);
  assert.equal(created.custom, true);
  assert.equal(created.catalog_id, null);
  const edited = await f.work.saveSource(
    o,
    created.id,
    { ...source, base_revision: 1, title: "Edited source" },
    "source-fields-edit",
  );
  assert.deepEqual(
    await f.work.saveSource(o, created.id, source, "source-fields-original"),
    created,
  );
  const removed = await f.work.deleteSource(
    o,
    created.id,
    { base_revision: 2 },
    "source-fields-delete",
  );
  assert.equal(removed.archived, true);
  assert.ok(removed.deleted_at);
  assert.equal((await f.work.sources(o)).items.length, 0);
  assert.equal((await f.work.sourceHistory(o, created.id)).items.length, 3);
  assert.equal((await f.work.source(o, created.id)).revision, 3);
  await assert.rejects(
    f.work.saveSource(
      o,
      created.id,
      { ...source, base_revision: 3 },
      "source-fields-reuse",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    f.work.create(
      o,
      { kind: "collect_source", source_id: created.id, base_revision: 3 },
      "source-deleted-collect",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(f.work.source({ ...o, userId: "other" }, created.id), {
    statusCode: 404,
  });
  const exported = await new ReadingService(f.repo).export(o);
  assert.equal(exported.sources[0].deleted_at, removed.deleted_at);
  assert.equal(exported.source_history[0].versions[1].title, edited.title);
  for (const invalid of [
    { domains: ["example.com/path"] },
    { domains: ["user:secret@example.com"] },
    { domains: ["127.0.0.1"] },
    { topics: ["unknown"] },
    { language: "xx" },
    { catalog_id: "aeon" },
  ])
    await assert.rejects(
      f.work.saveSource(
        o,
        "source-invalid",
        { ...source, ...invalid },
        "source-fields-invalid",
      ),
      { statusCode: 422 },
    );
  const catalog = (await f.prefs.setup(o)).default_sources[0],
    copy = await f.work.saveSource(
      o,
      catalog.id,
      {
        base_revision: 0,
        title: catalog.title,
        url: catalog.url,
        format: catalog.format,
        archived: false,
        catalog_id: catalog.catalog_id,
      },
      "source-catalog-copy",
    );
  assert.equal(copy.custom, false);
  assert.deepEqual(copy.domains, catalog.domains);
  await f.work.deleteSource(
    o,
    copy.id,
    { base_revision: 1 },
    "source-catalog-remove",
  );
  const initial = (await f.prefs.read(o)).value;
  await assert.rejects(
    f.prefs.save(
      o,
      { base_revision: 0, value: { ...initial, source_ids: [copy.id] } },
      "preferences-deleted-source",
    ),
    { statusCode: 409 },
  );
});
test("preference validation and receipt failure are atomic across values, versions and owner cleanup", async () => {
  const f = setup(),
    value = (await f.prefs.read(o)).value;
  for (const invalid of [
    { hour: 24 },
    { minute: 60 },
    { count: 9 },
    { count: 0 },
    { mode: "random" },
    { topics: [] },
    { languages: [] },
    { languages: ["fr"] },
    { query: "x".repeat(301) },
    { auto_guide: "true" },
    { source_ids: ["source-other-owner"] },
    { unknown: true },
  ])
    await assert.rejects(
      f.prefs.save(
        o,
        { base_revision: 0, value: { ...value, ...invalid } },
        "preferences-invalid-value",
      ),
    );
  assert.equal((await f.prefs.read(o)).revision, 0);
  const duplicate = normalizeReadingPreferences({
    ...value,
    topics: Array(10).fill("认知"),
    languages: ["zh", "zh", "en"],
  });
  assert.deepEqual(duplicate.topics, ["认知"]);
  assert.deepEqual(duplicate.languages, ["zh", "en"]);
  const save = f.repo.saveOperation.bind(f.repo);
  f.repo.saveOperation = async () => {
    throw Error("receipt unavailable");
  };
  await assert.rejects(
    f.prefs.save(o, { base_revision: 0, value }, "preferences-rollback-key"),
    /receipt unavailable/,
  );
  f.repo.saveOperation = save;
  assert.equal((await f.prefs.history(o)).items.length, 0);
  assert.equal((await f.prefs.read(o)).revision, 0);
});

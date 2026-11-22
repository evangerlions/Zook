import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import {
  exerciseExperience,
  exerciseExperiencePages,
} from "../support/experience-acceptance.ts";
test("independent application/error/type facts preserve unknown scores, historical classification, linked repeats, erasure and original intent", async () => {
  const repo = new InMemoryLightTickRepository();
  await exerciseExperience(repo);
  await exerciseExperiencePages(repo);
});
import assert from "node:assert/strict";
import { ExperienceService } from "../../src/modules/lighttick/experience/experience.service.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import type { ExperienceObject } from "../../src/modules/lighttick/experience/experience.types.ts";
const owner = { appId: "lighttick", userId: "experience-extra-unit" } as const;
test("classification snapshots retain historical names; explicit refreshed selection is revision-fenced", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new ExperienceService(repo),
    now = new Date().toISOString();
  const m = {
    ...owner,
    id: "module-personal-category",
    title: "Original category",
    description: "Only classification metadata",
    templateId: null,
    revision: 1,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await repo.learningModules.save(m, 0);
  const data = {
      date: null,
      module_id: m.id,
      concept: "Independent concept",
      scenario: null,
      effectiveness: null,
    },
    body = { base_revision: 0, data, classification_revision: 1 };
  let row = (await s.write(
    owner,
    "application",
    "application-category-snapshot",
    "save",
    body,
    "experience-category-original",
  )) as ExperienceObject;
  await repo.learningModules.save(
    { ...m, title: "Renamed category", revision: 2 },
    1,
  );
  row = (await s.write(
    owner,
    "application",
    row.id,
    "save",
    { ...body, base_revision: 1, data: { ...data, scenario: "User edited" } },
    "experience-category-retain",
  )) as ExperienceObject;
  assert.equal(row.classification?.title, "Original category");
  await assert.rejects(
    s.write(
      owner,
      "application",
      row.id,
      "save",
      { ...body, base_revision: 2, refresh_classification: true },
      "experience-category-stale",
    ),
    { statusCode: 409 },
  );
  row = (await s.write(
    owner,
    "application",
    row.id,
    "save",
    {
      ...body,
      base_revision: 2,
      classification_revision: 2,
      refresh_classification: true,
    },
    "experience-category-refresh",
  )) as ExperienceObject;
  assert.equal(row.classification?.title, "Renamed category");
  assert.equal(
    (await s.history(owner, "application", row.id)).items.at(-1)?.classification
      ?.title,
    "Original category",
  );
  await assert.rejects(
    s.write(
      { ...owner, userId: "foreign-owner" },
      "application",
      "application-foreign",
      "save",
      body,
      "experience-category-foreign",
    ),
    { statusCode: 409 },
  );
});
test("full Unicode character capacity is retained and complete export pages are revision-bound with independently checked digests", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new ExperienceService(repo),
    data = {
      date: null,
      module_id: null,
      concept: "🙂".repeat(100),
      scenario: null,
      effectiveness: null,
    };
  await s.write(
    owner,
    "application",
    "application-unicode-capacity",
    "save",
    { base_revision: 0, classification_revision: null, data },
    "experience-unicode-original",
  );
  await assert.rejects(
    s.write(
      owner,
      "application",
      "application-unicode-overflow",
      "save",
      {
        base_revision: 0,
        classification_revision: null,
        data: { ...data, concept: "🙂".repeat(101) },
      },
      "experience-unicode-overflow",
    ),
    { statusCode: 422 },
  );
  await assert.rejects(
    s.write(
      owner,
      "application",
      "application-surrogate",
      "save",
      {
        base_revision: 0,
        classification_revision: null,
        data: { ...data, concept: "\ud800" },
      },
      "experience-surrogate",
    ),
    { statusCode: 422 },
  );
  for (const section of ["objects", "versions", "tombstones", "receipts"]) {
    let cursor: string | null = null;
    const keys: string[] = [];
    do {
      const page = await s.export(owner, {
        section,
        limit: "1",
        ...(cursor ? { cursor } : {}),
      });
      const { page_sha256, next_cursor, ...body } = page;
      assert.equal(digest(body), page_sha256);
      keys.push(...page.records.map((r) => r.key));
      cursor = page.next_cursor;
    } while (cursor);
    assert.equal(new Set(keys).size, keys.length);
    if (section !== "tombstones") assert.equal(keys.length, 1);
  }
  const before = await s.export(owner);
  await s.write(
    owner,
    "error_type",
    "errtype-after-export",
    "save",
    { base_revision: 0, data: { name: "Changed data", description: "" } },
    "experience-export-changed",
  );
  await assert.rejects(
    s.export(owner, { section: "versions", revision: before.dataset_revision }),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.stats(owner, "application", { period: "365", end: "0001-01-01" }),
    { statusCode: 422 },
  );
});
test("public default type history preserves catalog version0, archive does not resurrect it and malformed filters fail closed", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new ExperienceService(repo),
    id = "errtype-default-attention";
  await s.write(
    owner,
    "error_type",
    id,
    "archive",
    { base_revision: 0 },
    "experience-archive-default",
  );
  assert.equal(
    (await s.list(owner, "error_type")).items.some((r) => r.id === id),
    false,
  );
  assert.deepEqual(
    (await s.history(owner, "error_type", id)).items.map((r) => r.revision),
    [1, 0],
  );
  assert.equal(
    (await s.list(owner, "error_type", { archived: "archived" })).items[0].id,
    id,
  );
  await assert.rejects(s.list(owner, "error_type", { module_id: "renzhi" }), {
    statusCode: 422,
  });
  await assert.rejects(s.list(owner, "error", { cursor: "?" }), {
    statusCode: 422,
  });
});
test("editing migrated unknown dates/classification never invents creation time or historical category names", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new ExperienceService(repo),
    r: ExperienceObject = {
      id: "application-migrated-unknown",
      kind: "application",
      revision: 1,
      archived: false,
      data: {
        date: null,
        module_id: "renzhi",
        concept: "Legacy unknown facts",
        scenario: null,
        effectiveness: null,
      },
      classification: null,
      type_revision: null,
      created_at: null,
      updated_at: null,
    };
  await repo.transaction(owner, () => repo.experience.save(owner, r, 0));
  const updated = (await s.write(
    owner,
    "application",
    r.id,
    "save",
    {
      base_revision: 1,
      classification_revision: null,
      data: { ...r.data, scenario: "Explicitly edited today" },
    },
    "experience-retain-unknown",
  )) as ExperienceObject;
  assert.equal(updated.created_at, null);
  assert.equal(updated.classification, null);
  assert.equal((updated.data as any).date, null);
});

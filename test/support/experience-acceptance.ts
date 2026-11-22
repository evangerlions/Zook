import assert from "node:assert/strict";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import type {
  ExperienceObject,
  ErrorData,
  ApplicationData,
  ErrorTypeData,
} from "../../src/modules/lighttick/experience/experience.types.ts";
import { ExperienceService } from "../../src/modules/lighttick/experience/experience.service.ts";
export const experienceOwner = {
  appId: "lighttick",
  userId: "experience-synthetic",
} as const;
export async function exerciseExperience(repo: LightTickRepository) {
  const o = experienceOwner,
    s = new ExperienceService(
      repo,
      async () => {},
      () => new Date("2026-11-12T00:00:00Z"),
    ),
    other = { ...o, userId: o.userId + "-other" };
  let seq = 0;
  const save = async (
    kind: "application" | "error" | "error_type",
    id: string,
    data: unknown,
    base = 0,
  ) =>
    (await s.write(
      o,
      kind,
      id,
      "save",
      {
        base_revision: base,
        data,
        ...(kind !== "error_type"
          ? {
              classification_revision:
                (data as any).module_id === null ? null : 1,
            }
          : {}),
        ...(kind === "error"
          ? { type_revision: (data as any).type_id === null ? null : 1 }
          : {}),
      },
      "experience-write-" + ++seq,
    )) as ExperienceObject;
  assert.equal((await s.setup(o)).personal_projects_preloaded, false);
  assert.equal((await s.list(o, "error_type")).items.length, 8);
  const appBody = {
      base_revision: 0,
      classification_revision: 1,
      data: {
        date: "2026-11-12",
        module_id: "renzhi",
        concept: "  Evidence 🙂  ",
        scenario: "Exact scenario % _",
        effectiveness: 0,
      },
    },
    app = (await s.write(
      o,
      "application",
      "application-original",
      "save",
      appBody,
      "experience-application-original",
    )) as ExperienceObject;
  assert.equal((app.data as ApplicationData).concept, "  Evidence 🙂  ");
  assert.equal(app.classification?.basis, "grow-category-v1");
  assert.deepEqual(
    await s.write(
      o,
      "application",
      app.id,
      "save",
      appBody,
      "experience-application-original",
    ),
    app,
  );
  assert.equal(
    (await s.stats(o, "application", { end: "2026-11-12", period: "2" }))
      .effectiveness.unrated,
    1,
  );
  await assert.rejects(
    s.write(
      o,
      "application",
      app.id,
      "save",
      { ...appBody, data: { ...appBody.data, effectiveness: 5 } },
      "experience-application-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    save("application", "application-invalid-date", {
      ...appBody.data,
      date: "2026-02-31",
    }),
    { statusCode: 422 },
  );
  await assert.rejects(
    save("application", "application-invalid-text", {
      ...appBody.data,
      concept: "bad\0text",
    }),
    { statusCode: 422 },
  );
  const t = await save("error_type", "errtype-review", {
    name: "Review original",
    description: "Type original description",
  });
  await assert.rejects(
    save("error_type", "errtype-duplicate", {
      name: "判断偏差",
      description: "Conflict public default",
    }),
    { statusCode: 409 },
  );
  const data: ErrorData = {
    date: "2026-11-11",
    module_id: "renzhi",
    error_type: "Review original",
    type_id: t.id,
    description: "Original mistake 🙂",
    severity: 0,
    context: "Context retained",
    improvement_action: "Check source",
    is_repeat: false,
    related_error_id: null,
  };
  let a = await save("error", "error-original", data),
    b = await save("error", "error-repeated", {
      ...data,
      date: "2026-11-12",
      description: "Second independent error",
      severity: null,
      is_repeat: true,
      related_error_id: a.id,
    });
  await assert.rejects(
    save("error", a.id, { ...data, related_error_id: b.id }, 1),
    { statusCode: 422 },
  );
  assert.equal((await s.read(o, "error", a.id)).revision, 1);
  b = await save(
    "error",
    b.id,
    { ...b.data, related_error_id: null },
    b.revision,
  );
  assert.equal((b.data as ErrorData).related_error_id, null);
  await save(
    "error_type",
    t.id,
    { name: "Review renamed", description: "Current name changed" },
    1,
  );
  assert.equal((await s.read(o, "error", a.id)).type_revision, 1);
  assert.equal(
    (await s.read(o, "error", a.id)).data.error_type,
    "Review original",
  );
  await assert.rejects(save("error", "error-stale-type", data), {
    statusCode: 409,
  });
  const c = await save("error", "error-unknown-date", {
    ...data,
    date: null,
    type_id: null,
    severity: 5,
    is_repeat: null,
  });
  let stats = await s.stats(o, "error", { end: "2026-11-12", period: "2" });
  assert.equal(stats.total, 2);
  assert.equal(stats.unknown_date, 1);
  assert.deepEqual(stats.severity, { average: "0.0", known: 1, unknown: 1 });
  assert.deepEqual(stats.repeat, {
    rate: "0.50",
    marked: 1,
    known: 2,
    unknown: 0,
  });
  assert.equal(stats.trend.length, 2);
  assert.deepEqual(
    stats.trend.map((x) => x.count),
    [1, 1],
  );
  const groups = await s.repeated(o);
  assert.equal(groups.items[0].count, 3);
  assert.equal(groups.items[0].unknown_dates, 1);
  assert.equal(groups.items[0].first_occurrence, "2026-11-11");
  assert.equal(
    (await s.list(o, "error", { is_repeat: "true" })).items.length,
    1,
  );
  const filtered = await s.list(o, "application", { search: "% _" });
  assert.equal(filtered.items.length, 1);
  assert.equal("data" in filtered.items[0], false);
  const first = await s.list(o, "error", { limit: "1" });
  assert.ok(first.next_cursor);
  await assert.rejects(
    s.list(other, "error", { limit: "1", cursor: first.next_cursor! }),
    { statusCode: 409 },
  );
  const next = await s.list(o, "error", {
    limit: "1",
    cursor: first.next_cursor!,
  });
  assert.notEqual(first.items[0].id, next.items[0].id);
  a = (await s.write(
    o,
    "error",
    a.id,
    "archive",
    { base_revision: a.revision },
    "experience-archive-original",
  )) as ExperienceObject;
  assert.equal(
    (await s.stats(o, "error", { end: "2026-11-12", period: "2" })).total,
    1,
  );
  await assert.rejects(
    s.list(o, "error", { limit: "1", cursor: first.next_cursor! }),
    { statusCode: 409 },
  );
  a = (await s.write(
    o,
    "error",
    a.id,
    "restore",
    { base_revision: a.revision },
    "experience-restore-original",
  )) as ExperienceObject;
  b = await save(
    "error",
    b.id,
    { ...b.data, related_error_id: a.id },
    b.revision,
  );
  const preview = await s.deletionPreview(o, "error", a.id);
  assert.equal(preview.references, 1);
  const deleted = await s.write(
    o,
    "error",
    a.id,
    "delete",
    { base_revision: a.revision, scope_digest: preview.scope_digest },
    "experience-delete-parent",
  );
  assert.equal(deleted.deleted, true);
  await assert.rejects(s.read(o, "error", a.id), { statusCode: 410 });
  assert.equal((await s.read(o, "error", b.id)).data.related_error_id, a.id);
  b = await save(
    "error",
    b.id,
    { ...b.data, context: "Edited while retaining deleted historical parent" },
    b.revision,
  );
  await assert.rejects(s.receipt(o, "experience-archive-original"), {
    statusCode: 410,
  });
  assert.equal(
    (await repo.getOperation(o, "experience-archive-original"))!
      .requestPayload &&
      Object.keys(
        (await repo.getOperation(o, "experience-archive-original"))!
          .requestPayload,
      ).length,
    0,
  );
  const tp = await s.deletionPreview(o, "error_type", t.id);
  await assert.rejects(
    s.write(
      o,
      "error_type",
      t.id,
      "delete",
      { base_revision: 2, scope_digest: tp.scope_digest },
      "experience-delete-referenced-type",
    ),
    { statusCode: 409 },
  );
  b = await save("error", b.id, { ...b.data, type_id: null }, b.revision);
  const tpc = await s.deletionPreview(o, "error_type", t.id);
  await s.write(
    o,
    "error_type",
    t.id,
    "delete",
    { base_revision: 2, scope_digest: tpc.scope_digest },
    "experience-delete-type",
  );
  const defaultId = "errtype-default-judgment",
    defaultScope = await s.deletionPreview(o, "error_type", defaultId);
  await s.write(
    o,
    "error_type",
    defaultId,
    "delete",
    { base_revision: 0, scope_digest: defaultScope.scope_digest },
    "experience-hide-default",
  );
  assert.equal(
    (await s.list(o, "error_type")).items.some((t) => t.id === defaultId),
    false,
  );
  const dp = await s.deletionPreview(o, "application", app.id);
  await s.write(
    o,
    "application",
    app.id,
    "delete",
    { base_revision: 1, scope_digest: dp.scope_digest },
    "experience-delete-application",
  );
  await assert.rejects(
    s.write(
      o,
      "application",
      app.id,
      "save",
      appBody,
      "experience-application-original",
    ),
    { statusCode: 410 },
  );
  await assert.rejects(
    s.write(
      o,
      "application",
      app.id,
      "save",
      appBody,
      "experience-reuse-deleted-id",
    ),
    { statusCode: 410 },
  );
  assert.equal(
    (await s.receipt(other, "experience-delete-application")).found,
    false,
  );
  const head = await repo.domainChanges.head(o, "experience"),
    originalSave = repo.saveOperation;
  repo.saveOperation = async () => {
    throw Error("synthetic receipt rollback");
  };
  try {
    await assert.rejects(
      save("application", "application-rollback", {
        ...appBody.data,
        concept: "Rollback only",
      }),
      /synthetic receipt rollback/,
    );
  } finally {
    repo.saveOperation = originalSave;
  }
  assert.equal(
    await repo.experience.get(o, "application", "application-rollback"),
    undefined,
  );
  assert.equal(await repo.domainChanges.head(o, "experience"), head);
  assert.equal((await repo.pullChanges(o, 0, 100)).length, 0);
  assert.equal((await s.read(o, "error", c.id)).data.date, null);
  return { s, o, b, c };
}
export async function exerciseExperiencePages(repo: LightTickRepository) {
  const o = experienceOwner,
    s = new ExperienceService(repo),
    base = {
      date: "2026-11-12",
      module_id: null,
      error_type: "",
      type_id: null,
      description: "Unicode identity group",
      severity: 0,
      context: null,
      improvement_action: null,
      is_repeat: null,
      related_error_id: null,
    };
  for (const [i, name] of ["\ue000", "🙂"].entries())
    for (let j = 0; j < 2; j++)
      await s.write(
        o,
        "error",
        `error-unicode-${i}-${j}`,
        "save",
        {
          base_revision: 0,
          classification_revision: null,
          type_revision: null,
          data: { ...base, error_type: name },
        },
        `experience-unicode-error-${i}-${j}`,
      );
  const names: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await s.repeated(o, {
      limit: "1",
      ...(cursor ? { cursor } : {}),
    });
    names.push(...page.items.map((r) => r.error_type));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(names, ["Review original", "\ue000", "🙂"]);
  for (const [i, concept] of ["🙂", "\ue000", "🙂"].entries())
    await s.write(
      o,
      "application",
      "application-concept-" + i,
      "save",
      {
        base_revision: 0,
        classification_revision: null,
        data: {
          date: null,
          module_id: null,
          concept,
          scenario: null,
          effectiveness: null,
        },
      },
      "experience-concept-" + i,
    );
  const first = await s.concepts(o, { limit: "1" });
  assert.deepEqual(first.items, ["\ue000"]);
  assert.deepEqual(
    (await s.concepts(o, { limit: "1", cursor: first.next_cursor! })).items,
    ["🙂"],
  );
  const digest = (
    await import(
      "../../src/modules/lighttick/learning/native-learning.validation.ts"
    )
  ).digest;
  const sections: Record<string, number> = {};
  let revision: string | undefined;
  for (const section of ["objects", "versions", "tombstones", "receipts"]) {
    const keys = new Set<string>();
    cursor = null;
    let count = 0;
    do {
      const page = await s.export(o, {
        section,
        limit: "1",
        ...(revision ? { revision } : {}),
        ...(cursor ? { cursor } : {}),
      });
      revision ??= page.dataset_revision;
      const { next_cursor, page_sha256, ...body } = page;
      assert.equal(digest(body), page_sha256);
      for (const r of page.records) {
        assert.ok(!keys.has(r.key));
        keys.add(r.key);
        count++;
      }
      cursor = next_cursor;
    } while (cursor);
    sections[section] = count;
  }
  assert.ok(sections.objects >= 9);
  assert.ok(sections.versions > sections.objects);
  assert.equal(sections.tombstones, 4);
  assert.ok(sections.receipts > sections.versions);
  return sections;
}

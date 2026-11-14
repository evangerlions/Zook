import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLearningReview,
  reviewQuery,
} from "../../src/modules/lighttick/learning/learning-review.service.ts";
const row = {
  lesson_id: "lesson-one",
  content_version: "a".repeat(64),
  title: "跨日学习",
  module: "module/english-reading",
  module_label: "英文阅读",
  available: true,
  is_current: true,
};
test("learning calendar uses completion timezone, counts module once per day and preserves version details", () => {
  const result = buildLearningReview(
    [
      { ...row, completed_at: "2026-10-31T16:30:00Z" },
      { ...row, lesson_id: "lesson-two", completed_at: "2026-11-01T02:00:00Z" },
      { ...row, content_version: "b".repeat(64), completed_at: null },
    ],
    { month: "2026-11", module: "", timezone: "Asia/Shanghai" },
    { modules: [], checkins: {}, habits: {} },
  );
  assert.equal(result.days.length, 30);
  assert.equal(result.days[0].completed_lessons, 2);
  assert.equal(result.days[0].module_days, 1);
  assert.equal(result.summary.learning_days, 1);
  assert.equal(result.summary.completed_lessons, 2);
  assert.equal(result.unknown_date_count, 1);
  assert.equal(result.modules[0].learning_days, 1);
  assert.equal(result.modules[0].completed_lessons, 2);
  assert.equal(
    buildLearningReview(
      [{ ...row, completed_at: "2026-10-31T16:30:00Z" }],
      { month: "2026-11", module: "", timezone: "UTC" },
      { modules: [], checkins: {}, habits: {} },
    ).summary.completed_lessons,
    0,
  );
});
test("manual checkins merge without inventing lesson completions; durations stay separate and filters do not hide modules", () => {
  const result = buildLearningReview(
    [{ ...row, completed_at: "2026-11-02T00:00:00Z" }],
    { month: "2026-11", module: "manual/writing", timezone: "UTC" },
    {
      modules: [{ id: "writing", name: "表达", color: "#fff", order: 1 }],
      checkins: { "2026-11-01": { writing: 3 }, "2026-11-02": { writing: 0 } },
      habits: { "2026-11-01": { minutes: 15, note: "" } },
    },
  );
  assert.equal(result.summary.completed_lessons, 0);
  assert.equal(result.summary.learning_days, 1);
  assert.equal(result.days[0].manual_modules, 1);
  assert.equal(result.modules.length, 2);
  assert.equal(result.days[0].manual_minutes, 15);
  assert.equal(result.items.length, 0);
  for (const month of ["2026-13", "2026-00", "26-01"])
    assert.throws(() => reviewQuery({ month }, new Date()));
  assert.throws(() =>
    reviewQuery({ month: "2026-01", module: "../bad" }, new Date()),
  );
  assert.equal(reviewQuery({ month: "2024-02" }, new Date()).month, "2024-02");
});

import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningReviewService } from "../../src/modules/lighttick/learning/learning-review.service.ts";
test("retained completion versions remain discoverable, owner scoped and consent limited; notes and position never create completions", async () => {
  const repo = new InMemoryLightTickRepository(),
    o = { appId: "lighttick" as const, userId: "review-alice" };
  let now = new Date("2026-11-01T08:00:00Z");
  const learning = new NativeLearningService(repo, true, () => now),
    service = new LearningReviewService(learning, repo, () => now);
  await learning.saveCollection(
    o,
    "collection-review",
    { base_revision: 0, title: "课程", archived: false },
    "review-collection",
  );
  const first = await learning.publish(
    o,
    "lesson-review-1",
    {
      base_revision: 0,
      collection_id: "collection-review",
      number: 1,
      title: "跨版课程",
      content: "# Original",
      references: "",
    },
    "review-publish",
  );
  await learning.privateCommand(
    o,
    first.id,
    {
      action: "save",
      content_version: first.content_version,
      base_revision: 0,
      notes: "私人原文不应出现在聚合",
      answers: [],
    },
    "review-note",
  );
  assert.equal(
    (await service.read(o, { month: "2026-11" })).summary.completed_lessons,
    0,
  );
  await learning.privateCommand(
    o,
    first.id,
    {
      action: "complete",
      content_version: first.content_version,
      base_revision: 0,
    },
    "review-complete",
  );
  await learning.publish(
    o,
    first.id,
    {
      base_revision: 1,
      collection_id: "collection-review",
      number: 1,
      title: "新课标题",
      content: "# New",
      references: "",
    },
    "review-republish",
  );
  const old = (await service.read(o, { month: "2026-11" })).items[0];
  assert.equal(old.is_current, false);
  assert.equal(old.available, true);
  assert.equal(old.content_version, first.content_version);
  const l = (await repo.getNativeLesson(o, first.id))!;
  await repo.saveNativeLesson(
    { ...l, archived: true, revision: l.revision + 1 },
    l.revision,
  );
  assert.equal(
    (await service.read(o, { month: "2026-11" })).items[0].available,
    false,
  );
  assert.equal(
    JSON.stringify(await service.read(o, { month: "2026-11" })).includes(
      "私人原文",
    ),
    false,
  );
  await learning.authority({ ...o, userId: "other" });
  assert.equal(
    (await service.read({ ...o, userId: "other" }, { month: "2026-11" })).items
      .length,
    0,
  );
  const a = (await repo.getLearningAuthority(o))!;
  await repo.saveLearningAuthority(
    { ...a, revision: a.revision + 1, privateEnabled: false },
    a.revision,
  );
  const limited = await service.read(o, { month: "2026-11" });
  assert.equal(limited.private_coverage, "not_authorized");
  assert.equal(limited.items.length, 0);
  await repo.saveLearningAuthority(
    { ...a, revision: a.revision + 2, readingEnabled: false },
    a.revision + 1,
  );
  await assert.rejects(service.read(o, { month: "2026-11" }), /consent/);
});

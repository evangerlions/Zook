import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningReviewService } from "../../src/modules/lighttick/learning/learning-review.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_learning_review_")
)
  throw Error("Dedicated synthetic learning review database required");
test("PostgreSQL calendar: retained versions, legacy unknown dates, timezone, deduplication, consent, owner isolation and reconnect", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "calendar-" + randomUUID() };
  let now = new Date("2026-10-31T16:30:00Z");
  const learning = new NativeLearningService(repo, true, () => now),
    review = new LearningReviewService(learning, repo, () => now);
  try {
    await repo.saveProfile({
      ...o,
      timezone: "Asia/Shanghai",
      locale: "zh-CN",
      pace: "balanced",
      onboardingState: "none",
      notificationPreferences: {},
      onboardingDraft: {},
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await learning.saveCollection(
      o,
      "calendar-course",
      {
        base_revision: 0,
        title: "Calendar",
        module_id: "english-reading",
        archived: false,
      },
      "calendar-create",
    );
    const first = await learning.publish(
      o,
      "lesson-calendar-one",
      {
        base_revision: 0,
        collection_id: "calendar-course",
        number: 1,
        title: "旧课",
        content: "# Old",
        references: "",
      },
      "calendar-publish",
    );
    await learning.privateCommand(
      o,
      first.id,
      {
        action: "complete",
        content_version: first.content_version,
        base_revision: 0,
      },
      "calendar-complete",
    );
    let result = await review.read(o, { month: "2026-11" });
    assert.equal(result.days[0].completed_lessons, 1);
    assert.equal(result.items[0].module_label, "英文阅读");
    await learning.publish(
      o,
      first.id,
      {
        base_revision: 1,
        collection_id: "calendar-course",
        number: 1,
        title: "新课",
        content: "# New",
        references: "",
      },
      "calendar-republish",
    );
    now = new Date("2026-11-02T01:00:00Z");
    const second = (await repo.getNativeLesson(o, first.id))!;
    await learning.privateCommand(
      o,
      first.id,
      {
        action: "complete",
        content_version: second.publishedVersion!,
        base_revision: 0,
      },
      "calendar-second-complete",
    );
    await repo.saveNativeLesson(
      {
        ...second,
        revision: second.revision + 1,
        sourceCompleted: true,
        sourceCompletedVersion: first.content_version,
      },
      second.revision,
    );
    result = await review.read(o, { month: "2026-11" });
    assert.equal(result.summary.completed_lessons, 2);
    assert.equal(result.items.filter((i) => !i.is_current).length, 1);
    assert.equal(result.unknown_date_count, 0);
    const a = (await repo.getLearningAuthority(o))!;
    await repo.saveLearningAuthority(
      { ...a, privateEnabled: false, revision: a.revision + 1 },
      a.revision,
    );
    const limited = await review.read(o, { month: "2026-11" });
    assert.equal(limited.items.length, 0);
    assert.equal(limited.unknown_date_count, 1);
    assert.equal(limited.private_coverage, "not_authorized");
    await repo.saveLearningAuthority(
      { ...a, revision: a.revision + 2 },
      a.revision + 1,
    );
    const l = (await repo.getNativeLesson(o, first.id))!;
    await repo.saveNativeLesson(
      { ...l, archived: true, revision: l.revision + 1 },
      l.revision,
    );
    const reopenedRepo = new PostgresLightTickRepository(pool),
      reopened = new LearningReviewService(
        new NativeLearningService(reopenedRepo, true),
        reopenedRepo,
      );
    assert.equal(
      (await reopened.read(o, { month: "2026-11" })).items.every(
        (i) => !i.available,
      ),
      true,
    );
    const other = { ...o, userId: "other-" + randomUUID() };
    await learning.authority(other);
    assert.equal(
      (await reopened.read(other, { month: "2026-11" })).items.length,
      0,
    );
    await repo.deleteOwnerData(other);
    const counts = await repo.getNativeLearningCounts(o);
    await review.read(o, { month: "2026-11" });
    assert.deepEqual(await repo.getNativeLearningCounts(o), counts);
    await repo.deleteOwnerData(o);
    assert.equal((await repo.listLearningCompletions(o, true)).length, 0);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

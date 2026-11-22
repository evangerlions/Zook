import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { CourseReviewService } from "../../src/modules/lighttick/course-review/course-review.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_course_review_")
)
  throw Error("Dedicated synthetic DB required");
test("PostgreSQL course review: CAS versions, frozen history, queue runner, reconnect, rollback, next draft and deletion", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    o = { appId: "lighttick" as const, userId: "course-pg-" + randomUUID() },
    native = new NativeLearningService(repo, true),
    work = new LearningWorkService(new LearningRouteService(native), {
      add: async () => ({}),
    } as any),
    service = new CourseReviewService(work);
  try {
    await native.saveCollection(
      o,
      "pg-course",
      { base_revision: 0, title: "PG course", archived: false },
      "pg-course-key",
    );
    const l = await native.publish(
      o,
      "lesson-pg-course",
      {
        base_revision: 0,
        collection_id: "pg-course",
        number: 1,
        title: "PG lesson",
        content: "# body not sent",
        references: "",
      },
      "pg-lesson-key",
    );
    await native.privateCommand(
      o,
      l.id,
      {
        action: "complete",
        content_version: l.content_version,
        base_revision: 0,
      },
      "pg-complete-key",
    );
    const f = {
      base_revision: 0,
      content_version: l.content_version,
      mastery_level: "partially_understood",
      value_rating: 2,
      feeling_tags: ["困惑"],
      key_learnings: "收获",
      questions: "疑问",
      next_direction: "实际案例",
    };
    const raced = await Promise.allSettled([
      service.feedback(o, "pg-course", l.id, f, "pg-feedback-a"),
      service.feedback(
        o,
        "pg-course",
        l.id,
        { ...f, next_direction: "另一方向" },
        "pg-feedback-b",
      ),
    ]);
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    const job = await service.generate(
      o,
      "pg-course",
      { base_revision: 1 },
      "pg-summary-key",
    );
    await service.feedback(
      o,
      "pg-course",
      l.id,
      { ...f, base_revision: 1, next_direction: "新方向" },
      "pg-feedback-new",
    );
    const runner = new LearningWorkRunner(
      work,
      {
        complete: async () => ({
          text: JSON.stringify({
            overview: "课程主题",
            self_assessment: "本人自评",
            connections: "待核实联系",
            next_directions: ["可选练习"],
            limitations: "未读取正文",
          }),
          provider: "fixture",
          providerModel: "fixture",
          finishReason: "stop",
        }),
      } as any,
      {} as any,
    );
    await runner.execute(o, job.id);
    assert.equal(
      (await service.summary(o, "pg-course", job.id)).status,
      "succeeded",
    );
    assert.notEqual(
      (await service.summary(o, "pg-course", job.id)).facts.lessons[0].feedback
        .next_direction,
      "新方向",
    );
    await assert.rejects(
      repo.transaction(o, async () => {
        await service.feedback(
          o,
          "pg-course",
          l.id,
          { ...f, base_revision: 2 },
          "pg-rollback-key",
        );
        throw Error("rollback");
      }),
    );
    assert.equal(
      (await service.read(o, "pg-course")).lessons[0].feedback!.revision,
      2,
    );
    const next = await service.prepare(
      o,
      "pg-course",
      {
        summary_id: job.id,
        brief: {
          title: "后续",
          goal: "用户方向",
          level: "基础",
          minutes: 20,
          pacing: "self_paced",
          lesson_count: 2,
        },
      },
      "pg-next-key",
    );
    assert.equal(
      (await work.store.get(o, next.id))!.input.course_review_context
        .summary_id,
      job.id,
    );
    assert.equal(
      await repo.learningRoutes.getLearningRoute(o, next.route_id),
      undefined,
    );
    const reopenedRepo = new PostgresLightTickRepository(pool),
      reopened = new CourseReviewService(
        new LearningWorkService(
          new LearningRouteService(
            new NativeLearningService(reopenedRepo, true),
          ),
          { add: async () => ({}) } as any,
        ),
      );
    assert.equal(
      (await reopened.summary(o, "pg-course", job.id)).output.overview,
      "课程主题",
    );
    assert.equal((await reopened.history(o, "pg-course", {})).items.length, 1);
    await assert.rejects(
      reopened.summary({ ...o, userId: "other" }, "pg-course", job.id),
    );
    await repo.deleteOwnerData(o);
    assert.equal((await repo.courseReview.list(o, "pg-course")).length, 0);
    assert.equal(await work.store.get(o, job.id), undefined);
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});

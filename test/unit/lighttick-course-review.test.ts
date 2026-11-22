import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { CourseReviewService } from "../../src/modules/lighttick/course-review/course-review.service.ts";
const o = { appId: "lighttick" as const, userId: "review-alice" };
async function fixture() {
  const repo = new InMemoryLightTickRepository(),
    native = new NativeLearningService(repo, true),
    queue = { add: async () => ({}) } as any,
    work = new LearningWorkService(new LearningRouteService(native), queue),
    service = new CourseReviewService(work);
  await native.saveCollection(
    o,
    "review-course",
    { base_revision: 0, title: "整门课程", archived: false },
    "collection-review-key",
  );
  const lesson = await native.publish(
    o,
    "lesson-review-one",
    {
      base_revision: 0,
      collection_id: "review-course",
      number: 1,
      title: "第一课",
      content: "# 不应发给模型的正文",
      references: "",
    },
    "publish-review-key",
  );
  await native.privateCommand(
    o,
    lesson.id,
    {
      action: "save",
      content_version: lesson.content_version,
      base_revision: 0,
      notes: "不应发给模型的私人笔记",
      answers: [],
    },
    "notes-review-key",
  );
  return { repo, native, work, service, lesson };
}
const feedback = (v: string) => ({
  base_revision: 0,
  content_version: v,
  mastery_level: "partially_understood",
  value_rating: 2,
  feeling_tags: ["困惑"],
  key_learnings: "我能解释一部分",
  questions: "如何实践",
  next_direction: "用实际案例练习",
});
test("course review freezes explicit completion and self feedback, never note/body or inferred mastery", async () => {
  const f = await fixture();
  await assert.rejects(
    f.service.generate(
      o,
      "review-course",
      { base_revision: 1 },
      "no-completion-key",
    ),
  );
  await f.native.privateCommand(
    o,
    f.lesson.id,
    {
      action: "complete",
      content_version: f.lesson.content_version,
      base_revision: 0,
    },
    "complete-review-key",
  );
  await f.service.feedback(
    o,
    "review-course",
    f.lesson.id,
    feedback(f.lesson.content_version),
    "feedback-review-key",
  );
  const job = await f.service.generate(
    o,
    "review-course",
    { base_revision: 1 },
    "generate-review-key",
  );
  const row = (await f.work.store.get(o, job.id))!;
  assert.equal(row.input.course_review.lessons.length, 1);
  assert.equal(JSON.stringify(row.input).includes("不应发给模型"), false);
  await f.service.feedback(
    o,
    "review-course",
    f.lesson.id,
    {
      ...feedback(f.lesson.content_version),
      base_revision: 1,
      next_direction: "修改后的方向",
    },
    "feedback-revised-key",
  );
  assert.equal(
    row.input.course_review.lessons[0].feedback.next_direction,
    "用实际案例练习",
  );
  let text = "";
  const runner = new LearningWorkRunner(
    f.work,
    {
      complete: async (r: any) => {
        assert.deepEqual(r.usageOwner,o);
        text = JSON.stringify(r.messages);
        return {
          text: JSON.stringify({
            overview: "主题回顾",
            self_assessment: "这是本人自评",
            connections: "待验证联系",
            next_directions: ["用实际案例练习"],
            limitations: "未读取正文，无客观掌握证据",
          }),
          provider: "fixture",
          providerModel: "fixture-model",
          finishReason: "stop",
        };
      },
    } as any,
    {} as any,
  );
  await runner.execute(o, job.id);
  const result = await f.service.summary(o, "review-course", job.id);
  assert.equal(result.status, "succeeded");
  assert.equal(text.includes("不应发给模型"), false);
  assert.equal(text.includes("用实际案例练习"), true);
  await assert.rejects(
    f.service.summary({ ...o, userId: "other" }, "review-course", job.id),
  );
});
test("feedback has owner/version CAS and summary cancellation fences late output after consent withdrawal", async () => {
  const f = await fixture();
  await assert.rejects(
    f.service.feedback(
      o,
      "review-course",
      f.lesson.id,
      feedback("a".repeat(64)),
      "wrong-version-key",
    ),
  );
  await f.native.privateCommand(
    o,
    f.lesson.id,
    {
      action: "complete",
      content_version: f.lesson.content_version,
      base_revision: 0,
    },
    "completion-second-key",
  );
  await f.service.feedback(
    o,
    "review-course",
    f.lesson.id,
    feedback(f.lesson.content_version),
    "feedback-second-key",
  );
  await assert.rejects(
    f.service.feedback(
      o,
      "review-course",
      f.lesson.id,
      feedback(f.lesson.content_version),
      "stale-feedback-key",
    ),
  );
  const job = await f.service.generate(
    o,
    "review-course",
    { base_revision: 1 },
    "generate-second-key",
  );
  const a = (await f.repo.getLearningAuthority(o))!;
  await f.repo.saveLearningAuthority(
    { ...a, privateEnabled: false, revision: a.revision + 1 },
    a.revision,
  );
  await assert.rejects(f.service.summary(o, "review-course", job.id));
  await assert.rejects(f.work.read(o, job.id));
  const runner = new LearningWorkRunner(
    f.work,
    {
      complete: async () => {
        throw Error("must not call model");
      },
    } as any,
    {} as any,
  );
  await runner.execute(o, job.id);
  assert.equal((await f.work.store.get(o, job.id))!.status, "failed");
});
test("next course freezes summary context into existing route draft and cancellation fences late summary output", async () => {
  const f = await fixture();
  await f.native.privateCommand(
    o,
    f.lesson.id,
    {
      action: "complete",
      content_version: f.lesson.content_version,
      base_revision: 0,
    },
    "advanced-complete-key",
  );
  await f.service.feedback(
    o,
    "review-course",
    f.lesson.id,
    feedback(f.lesson.content_version),
    "advanced-feedback-key",
  );
  const job = await f.service.generate(
    o,
    "review-course",
    { base_revision: 1 },
    "advanced-summary-key",
  );
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const output = {
    overview: "主题回顾",
    self_assessment: "自评",
    connections: "待验证",
    next_directions: ["实际案例"],
    limitations: "未读取正文",
  };
  const runner = new LearningWorkRunner(
    f.work,
    {
      complete: async () => {
        await gate;
        return {
          text: JSON.stringify(output),
          provider: "fixture",
          providerModel: "fixture",
          finishReason: "stop",
        };
      },
    } as any,
    {} as any,
  );
  const running = runner.execute(o, job.id);
  while ((await f.work.store.get(o, job.id))!.status !== "running")
    await new Promise((r) => setTimeout(r, 1));
  const row = (await f.work.store.get(o, job.id))!;
  await f.work.cancel(
    o,
    job.id,
    { base_revision: row.revision },
    "cancel-summary-key",
  );
  release();
  await running;
  assert.equal((await f.work.store.get(o, job.id))!.output, null);
  const next = await f.service.generate(
    o,
    "review-course",
    { base_revision: 1 },
    "successful-summary-key",
  );
  await runner.execute(o, next.id);
  const advanced = await f.work.create(
    o,
    {
      kind: "route_draft",
      route_id: "plan-followup-course",
      base_revision: 0,
      brief: {
        title: "后续练习",
        goal: "实际案例",
        level: "基础巩固，不代表掌握",
        minutes: 20,
        pacing: "self_paced",
        lesson_count: 2,
      },
      review_id: next.id,
    },
    "create-followup-key",
  );
  const draft = (await f.work.store.get(o, advanced.id))!;
  assert.equal(draft.input.course_review_context.summary_id, next.id);
  assert.equal(draft.input.brief.level, "基础巩固，不代表掌握");
  assert.equal(
    await f.repo.learningRoutes.getLearningRoute(o, draft.routeId),
    undefined,
  );
  const a = (await f.repo.getLearningAuthority(o))!;
  await f.repo.saveLearningAuthority(
    { ...a, privateEnabled: false, revision: a.revision + 1 },
    a.revision,
  );
  await assert.rejects(f.work.read(o, advanced.id));
  assert.equal(
    (await f.work.list(o)).items.find((w) => w.id === advanced.id)?.output,
    null,
  );
});
test("partially published formal routes report the full planned lesson denominator", async () => {
  const f = await fixture(),
    id = "plan-reviewed-course",
    brief = {
      title: "Formal",
      goal: "Practice",
      level: "Foundation",
      minutes: 20,
      pacing: "self_paced" as const,
      lesson_count: 2,
    },
    document = {
      prerequisites: "Basics",
      stages: [{ title: "Stage", goal: "Practice" }],
      lessons: [1, 2].map((n) => ({
        number: n,
        topic: "Topic " + n,
        goal: "Goal",
        exercise: "Practice",
        assessment: "Evidence",
        minutes: 20,
        stage: 1,
        kind: n === 2 ? ("review" as const) : ("lesson" as const),
        requires: [],
      })),
    };
  const routes = new LearningRouteService(f.native);
  await routes.save(
    o,
    id,
    { base_revision: 0, brief, document },
    "formal-route-save",
  );
  await routes.publish(o, id, { base_revision: 1 }, "formal-route-publish");
  const l = await routes.publishLesson(
    o,
    id,
    1,
    {
      base_revision: 2,
      lesson_id: "lesson-formal-review",
      base_lesson_revision: 0,
      content: "# Body",
      references: "",
      source_url: "",
    },
    "formal-review-publish",
  );
  await f.native.privateCommand(
    o,
    l.id,
    {
      action: "complete",
      content_version: l.content_version,
      base_revision: 0,
    },
    "formal-review-complete",
  );
  const course = await f.service.read(o, id);
  assert.equal(course.lessons.length, 1);
  assert.equal(course.total_lessons, 2);
  const job = await f.service.generate(
    o,
    id,
    { base_revision: 1 },
    "formal-summary-key",
  );
  assert.equal(job.facts.completed_lessons, 1);
  assert.equal(job.facts.total_lessons, 2);
  assert.equal(job.facts.route_version, 1);
});

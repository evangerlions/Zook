import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "refinement-owner" };
const id = "plan-refinement-course";
const lessonId = "lesson-refinement-first";
const feedback = { focus: "第二课加入一个很短的练习", keep: ["保留已学的汇报结构"] };
const createBody = { kind: "route_refine", route_id: id, base_revision: 3, feedback };

async function fixture(enabled = () => true) {
  const repository = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repository, true, () => new Date("2026-11-23T08:00:00Z"));
  const routes = new LearningRouteService(native);
  const queue = new InMemoryJobQueue();
  const work = new LearningWorkService(routes, queue, enabled);
  await routes.save(owner, id, { base_revision: 0, ...routeFixture() }, "refine-initial-save");
  await routes.publish(owner, id, { base_revision: 1 }, "refine-initial-publish");
  const lesson = await routes.publishLesson(owner, id, 1, { base_revision: 2, base_lesson_revision: 0,
    lesson_id: lessonId, content: "原课正文", references: "本人资料" }, "refine-initial-body");
  const runner = (document: ReturnType<typeof routeFixture>["document"]) => new LearningWorkRunner(work, {
    complete: async input => {
      const prompt = input.messages.at(-1)?.content;
      assert.equal(typeof prompt, "string");
      const modelInput = JSON.parse(String(prompt).split("\nINPUT_JSON=").at(-1)!);
      assert.deepEqual(modelInput.current_outline, routeFixture().document);
      assert.deepEqual(modelInput.frozen, [routeFixture().document.lessons[0]]);
      assert.deepEqual(modelInput.feedback, { ...feedback, note: "", issues: [] });
      assert.equal("observation_source" in modelInput, false);
      assert.equal("model_selection" in modelInput, false);
      assert.equal(input.providerOptions?.zookLogBodyMode, "suppress");
      return { text: JSON.stringify(document), modelKey: "mock", provider: "mock", providerModel: "mock" };
    },
  }, { readFile: async () => { throw Error("Unexpected file"); }, fetchUrl: async () => { throw Error("Unexpected URL"); } });
  return { repository, native, routes, queue, work, lesson, runner };
}

test("future curriculum is explicitly adopted then published with a new version and old facts intact", async () => {
  const f = await fixture();
  const pinned = await f.native.publication(owner, lessonId, f.lesson.content_version);
  const before = await f.routes.read(owner, id, 1);
  const pending = await f.work.create(owner, createBody, "refine-create-once");
  assert.deepEqual(await f.work.create(owner, createBody, "refine-create-once"), pending);
  assert.doesNotMatch(JSON.stringify(f.queue.jobs), /第二课加入一个很短的练习/);
  const proposed = routeFixture().document;
  proposed.lessons[1]!.topic = "用一分钟复述结论";
  await f.runner(proposed).execute(owner, pending.id);
  const done = await f.work.read(owner, pending.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.output?.document.lessons[1].topic, proposed.lessons[1]!.topic);
  assert.equal((await f.repository.learningRoutes.getLearningRoute(owner, id))?.revision, 3);
  const body = { base_revision: done.revision, base_route_revision: done.base_revision, expected_digest: done.output_digest };
  const adopted = await f.work.adopt(owner, pending.id, body, "refine-adopt-once");
  assert.equal(adopted.result.published_version, 1);
  assert.deepEqual(await f.work.adopt(owner, pending.id, body, "refine-adopt-once"), adopted);
  await assert.rejects(f.work.adopt(owner, pending.id, body, "refine-adopt-again"), { statusCode: 409 });
  assert.deepEqual(await f.routes.read(owner, id, 1), before);
  const published = await f.routes.publish(owner, id, { base_revision: adopted.result.revision }, "refine-publish-once");
  assert.equal(published.published_version, 2);
  assert.deepEqual(published.document, proposed);
  assert.deepEqual(await f.routes.read(owner, id, 1), before);
  const preserved = await f.native.publication(owner, lessonId, f.lesson.content_version);
  assert.deepEqual(preserved.lesson, pinned.lesson);
  assert.deepEqual(preserved.publication, pinned.publication);
  assert.deepEqual(await f.repository.listTasks(owner), []);
});

test("frozen lessons, stage definitions and current route revision reject unsafe change", async () => {
  for (const change of ["lesson", "stage", "revision"] as const) {
    const f = await fixture();
    const pending = await f.work.create(owner, createBody, "refine-create-" + change);
    const proposed = routeFixture().document;
    if (change === "lesson") proposed.lessons[0]!.topic = "改写已发布的蓝图";
    if (change === "stage") proposed.stages[0]!.goal = "改写已发布课的阶段目标";
    if (change === "revision") {
      await f.routes.save(owner, id, { base_revision: 3, ...routeFixture() }, "refine-concurrent-save");
    }
    await f.runner(proposed).execute(owner, pending.id);
    const result = await f.work.read(owner, pending.id);
    assert.equal(result.status, "failed");
    assert.equal(result.output, null);
    assert.equal(result.error_code, change === "revision" ? "LEARNING_CONTEXT_STALE" : "LEARNING_OUTPUT_INVALID");
  }
});

test("the refinement gate and a published course with explicit feedback are validated before enqueue", async () => {
  const disabled = await fixture(() => false);
  await assert.rejects(disabled.work.create(owner, createBody, "refine-disabled"), { statusCode: 503 });
  const f = await fixture();
  await assert.rejects(f.work.create(owner, { ...createBody, feedback: { focus: " " } }, "refine-empty-feedback"), { statusCode: 422 });
  await assert.rejects(f.work.create(owner, { ...createBody, brief: { ...routeFixture().brief, minutes: 10 } }, "refine-invalid-frozen-limit"), { statusCode: 422 });
  await f.routes.transition(owner, id, { base_revision: 3, status: "paused" }, "refine-pause-course");
  await assert.rejects(f.work.create(owner, { ...createBody, base_revision: 4 }, "refine-paused-course"), { statusCode: 409 });
  assert.deepEqual(f.queue.jobs, []);
});

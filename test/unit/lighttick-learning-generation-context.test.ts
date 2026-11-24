import test from "node:test";
import assert from "node:assert/strict";
import { courseGenerationContext } from "../../src/modules/lighttick/learning/learning-generation-context.ts";
import { LightTickNativeLearningCourseDocumentSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { courseBrief } from "../../src/modules/lighttick/learning/learning-route.validation.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";

const owner = { appId: "lighttick" as const, userId: "course-context-synthetic" };
test("confirmed schedule tightens model schema without mutating the public contract", () => {
  const original = JSON.stringify(LightTickNativeLearningCourseDocumentSchema);
  for (const b of [
    { ...routeFixture().brief, pacing: "weekly", weeks: 4, sessions: 2 },
    { ...routeFixture().brief, pacing: "self_paced", lesson_count: 8 },
    { ...routeFixture().brief, pacing: "weekly", weeks: 1, sessions: 1 },
  ]) {
    const brief = courseBrief(b), { constraints, schema } = courseGenerationContext(brief);
    const count = brief.pacing === "weekly" ? brief.weeks! * brief.sessions! : brief.lesson_count!;
    assert.equal(constraints.lesson_count, count);
    assert.equal(schema.properties.lessons.minItems, count);
    assert.equal(schema.properties.lessons.maxItems, count);
    assert.equal(schema.properties.lessons.items.properties.minutes.maximum, brief.minutes);
    assert.equal(schema.properties.stages.maxItems, brief.pacing === "weekly" ? brief.weeks : count);
    assert.deepEqual(constraints.lesson_numbers, Array.from({ length: count }, (_, i) => i + 1));
  }
  assert.equal(JSON.stringify(LightTickNativeLearningCourseDocumentSchema), original);
});

test("actual runner sends exact weekly count to provider and continues rejecting shortened output", async () => {
  const repo = new InMemoryLightTickRepository(), queue = new InMemoryJobQueue();
  const native = new NativeLearningService(repo, true), service = new LearningWorkService(new LearningRouteService(native), queue);
  const brief = { ...routeFixture().brief, pacing: "weekly", weeks: 4, sessions: 2 };
  let calls = 0;
  const runner = new LearningWorkRunner(service, { complete: async (request: any) => {
    calls++;
    const user = request.messages[1].content;
    const constraints = JSON.parse(user.match(/COURSE_CONSTRAINTS=([^\n]+)/)[1]);
    const schema = JSON.parse(user.match(/OUTPUT_JSON_SCHEMA=([^\n]+)/)[1]);
    assert.equal(constraints.lesson_count, 8);
    assert.equal(schema.properties.lessons.minItems, 8);
    assert.equal(schema.properties.lessons.maxItems, 8);
    assert.match(user, /review occupies one of these lessons/);
    // A model that still returns only two lessons must fail rather than be padded or published.
    return { text: JSON.stringify(routeFixture().document), provider: "synthetic", providerModel: "fixture" };
  } } as any, { readFile: async () => "", fetchUrl: async () => "" });
  const work = await service.create(owner, { kind: "route_draft", route_id: "plan-context-weekly", base_revision: 0, brief }, "context-weekly-original");
  await runner.execute(owner, work.id);
  const result = await service.read(owner, work.id);
  assert.equal(calls, 1);
  assert.equal(result.error_code, "LEARNING_OUTPUT_INVALID");
  assert.equal(result.output, null);
  assert.equal(await repo.learningRoutes.getLearningRoute(owner, "plan-context-weekly"), undefined);
});

test("a complete eight-lesson response is accepted as a draft without publication", async () => {
  const repo = new InMemoryLightTickRepository(), queue = new InMemoryJobQueue();
  const native = new NativeLearningService(repo, true), service = new LearningWorkService(new LearningRouteService(native), queue);
  const fixture = routeFixture(), brief = { ...fixture.brief, pacing: "weekly", weeks: 4, sessions: 2 };
  const document = { ...fixture.document, lessons: Array.from({ length: 8 }, (_, i) => ({
    ...fixture.document.lessons[0], number: i + 1, stage: i < 4 ? 1 : 2, kind: i === 7 ? "review" : "lesson", requires: i ? [i] : [],
  })) };
  const runner = new LearningWorkRunner(service, { complete: async () => ({ text: JSON.stringify(document), provider: "synthetic", providerModel: "fixture" }) } as any,
    { readFile: async () => "", fetchUrl: async () => "" });
  const work = await service.create(owner, { kind: "route_draft", route_id: "plan-context-eight", base_revision: 0, brief }, "context-eight-original");
  await runner.execute(owner, work.id);
  const result = await service.read(owner, work.id);
  assert.equal(result.status, "succeeded");
  assert.equal(result.output!.document.lessons.length, 8);
  assert.equal(await repo.learningRoutes.getLearningRoute(owner, "plan-context-eight"), undefined);
});

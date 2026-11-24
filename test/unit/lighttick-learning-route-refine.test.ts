import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "learning-refine-synthetic" };
const routeId = "plan-learning-refine";

const feedback = {
  rating: 3,
  focus: "把第二课拆细一点",
  issues: [{ area: "pace", note: "第二课一次讲太多" }],
  keep: ["复习课"],
  note: "整体节奏可以，但第二课太难",
};

function setup(complete?: (input: any) => Promise<any>) {
  const now = new Date("2026-11-04T08:00:00Z");
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  const native = new NativeLearningService(repo, true, () => now),
    routes = new LearningRouteService(native),
    work = new LearningWorkService(routes, queue);
  const llm = {
    complete:
      complete ??
      (async () => ({
        text: JSON.stringify(routeFixture().document),
        provider: "synthetic",
        providerModel: "fixture",
      })),
  } as any;
  const runner = new LearningWorkRunner(work, llm, {
    readFile: async () => {
      throw Error("Unavailable owner file");
    },
    fetchUrl: async () => {
      throw Error("Unexpected external fetch");
    },
  });
  return { repo, queue, native, routes, work, runner, llm };
}

/** Creates the route and publishes it, leaving revision 2 and published_version 1. */
async function publishRoute(routes: LearningRouteService) {
  const fixture = routeFixture();
  await routes.save(
    owner,
    routeId,
    { base_revision: 0, brief: fixture.brief, document: fixture.document },
    "refine-route-save",
  );
  return routes.publish(owner, routeId, { base_revision: 1 }, "refine-route-publish");
}

async function refineRequest(work: LearningWorkService, key: string, body: Record<string, unknown> = {}) {
  const route = await work.native.repository.learningRoutes.getLearningRoute(owner, routeId);
  return work.create(
    owner,
    {
      kind: "route_refine",
      route_id: routeId,
      base_revision: route?.revision ?? 0,
      feedback,
      ...body,
    },
    key,
  );
}

test("refine requires a published, active course", async () => {
  const f = setup();
  const fixture = routeFixture();
  await f.routes.save(
    owner,
    routeId,
    { base_revision: 0, brief: fixture.brief, document: fixture.document },
    "refine-route-save",
  );
  await assert.rejects(
    refineRequest(f.work, "refine-unpublished"),
    { statusCode: 409 },
  );

  await f.routes.publish(owner, routeId, { base_revision: 1 }, "refine-route-publish");
  const route = (await f.routes.read(owner, routeId)) as any;
  await f.routes.transition(
    owner,
    routeId,
    { base_revision: route.revision, status: "paused" },
    "refine-route-pause",
  );
  await assert.rejects(refineRequest(f.work, "refine-paused"), { statusCode: 409 });
});

test("refine stores feedback, the published version and the frozen blueprints", async () => {
  const f = setup();
  await publishRoute(f.routes);
  await f.repo.learningRoutes.insertRouteLessonLink({
    ...owner,
    routeId,
    number: 1,
    lessonId: "lesson-refine-1",
    routeVersion: 1,
    firstContentVersion: "a".repeat(64),
  });

  const created = await refineRequest(f.work, "refine-create");
  const row = await f.work.store.get(owner, created.id);
  assert.equal(created.kind, "route_refine");
  assert.equal(row!.reservedMicros, 750000);
  assert.equal(row!.input.feedback.rating, 3);
  assert.equal(row!.input.feedback.issues[0].area, "pace");
  assert.equal(row!.input.base_version, 1);
  assert.equal(row!.input.frozen.length, 1);
  assert.deepEqual(
    row!.input.frozen[0],
    routeFixture().document.lessons[0],
  );
});

test("refine rejects empty feedback", async () => {
  const f = setup();
  await publishRoute(f.routes);
  await assert.rejects(
    refineRequest(f.work, "refine-empty", {
      feedback: { rating: undefined, focus: "", issues: [], keep: [], note: "" },
    }),
    { statusCode: 422 },
  );
  await assert.rejects(
    refineRequest(f.work, "refine-rating-out-of-range", {
      feedback: { ...feedback, rating: 6 },
    }),
    { statusCode: 422 },
  );
});

test("refine never lets the model rewrite a frozen published blueprint", async () => {
  const mutated = structuredClone(routeFixture().document);
  mutated.lessons[0].topic = "被悄悄改掉的已发布课";
  const f = setup(async () => ({
    text: JSON.stringify(mutated),
    provider: "synthetic",
    providerModel: "fixture",
  }));
  await publishRoute(f.routes);
  await f.repo.learningRoutes.insertRouteLessonLink({
    ...owner,
    routeId,
    number: 1,
    lessonId: "lesson-refine-1",
    routeVersion: 1,
    firstContentVersion: "a".repeat(64),
  });

  const created = await refineRequest(f.work, "refine-frozen-mutation");
  await f.runner.execute(owner, created.id);
  const done = await f.work.read(owner, created.id);
  assert.equal(done.status, "failed");
  assert.equal(done.error_code, "LEARNING_OUTPUT_INVALID");
  assert.equal(done.output, null);
});

test("adopting a refine keeps the published version and the frozen lessons intact", async () => {
  const f = setup();
  await publishRoute(f.routes);
  await f.repo.learningRoutes.insertRouteLessonLink({
    ...owner,
    routeId,
    number: 1,
    lessonId: "lesson-refine-1",
    routeVersion: 1,
    firstContentVersion: "a".repeat(64),
  });

  const created = await refineRequest(f.work, "refine-adopt");
  await f.runner.execute(owner, created.id);
  const done = await f.work.read(owner, created.id);
  assert.equal(done.status, "succeeded");

  const adopted = (await f.work.adopt(
    owner,
    created.id,
    {
      base_revision: done.revision,
      base_route_revision: done.base_revision,
      expected_digest: done.output_digest,
    },
    "refine-adopt-commit",
  )) as any;

  assert.equal(adopted.kind, "route_refine");
  assert.equal(adopted.result.published_version, 1);
  assert.deepEqual(
    adopted.result.document.lessons[0],
    routeFixture().document.lessons[0],
  );
});

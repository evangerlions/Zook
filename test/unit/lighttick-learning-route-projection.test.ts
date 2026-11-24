import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningRouteProjection } from "../../src/modules/lighttick/learning/learning-route-projection.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";

const owner = { appId: "lighttick" as const, userId: "route-projection-alice" };
const routeId = "plan-route-projection";
const day = "2026-11-16";

const clock = () => new Date(day + "T08:00:00Z");

const brief = {
  title: "三课小课",
  goal: "验证投影",
  level: "beginner",
  minutes: 30,
  pacing: "weekly" as const,
  weeks: 1,
  sessions: 3,
};

function lesson(number: number, topic: string, kind: "lesson" | "review") {
  return {
    number,
    topic,
    goal: "目标 " + number,
    exercise: "练习 " + number,
    assessment: "自测 " + number,
    minutes: 20,
    stage: 1,
    kind,
    requires: number === 1 ? [] : [1],
  };
}

const document = {
  prerequisites: "无",
  stages: [{ title: "第一阶段", goal: "打好基础" }],
  lessons: [lesson(1, "第一课", "lesson"), lesson(2, "第二课", "lesson"), lesson(3, "复习课", "review")],
};

function setup() {
  const repo = new InMemoryLightTickRepository();
  const actions = new ActionService(repo, clock, undefined, true);
  const learning = new NativeLearningService(repo, true, clock);
  const routes = new LearningRouteService(learning);
  const projection = new LearningRouteProjection(actions, repo.learningRoutes, clock);
  learning.routePublishedSink = (o, id, version) =>
    projection.onRoutePublished(o, id, version);
  return { repo, actions, learning, routes, projection };
}

async function publishRoute(
  routes: LearningRouteService,
  overrides: Record<string, unknown> = {},
  id = routeId,
) {
  await routes.save(
    owner,
    id,
    { base_revision: 0, brief, document, ...overrides },
    "route-save-" + id,
  );
  return routes.publish(owner, id, { base_revision: 1 }, "route-publish-" + id);
}

async function workspace(actions: ActionService) {
  return (await actions.readWorkspace(owner)).data as any;
}

test("publishing a route projects every lesson into one unscheduled content action", async () => {
  const { actions, routes } = setup();
  await publishRoute(routes);

  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 3);
  for (const plan of ws.plans) {
    assert.equal(plan.period, "day");
    assert.equal(plan.completion_mode, "content");
    assert.equal(plan.start_date, null);
    assert.equal(plan.end_date, null);
    assert.equal(plan.status, "active");
    assert.equal(plan.target.kind, "plan");
    assert.equal(plan.target.plan_id, routeId);
  }
  assert.deepEqual(
    ws.plans.map((p: any) => p.target.lesson_no),
    [1, 2, 3],
  );
  assert.equal(ws.plans[0].title, "第一课");
  assert.deepEqual(
    ws.content_sources.map((s: any) => s.lesson_no),
    [1, 2, 3],
  );
});

test("replaying the same published version creates nothing", async () => {
  const { actions, routes, projection } = setup();
  await publishRoute(routes);
  await projection.onRoutePublished(owner, routeId, 1);
  await projection.onRoutePublished(owner, routeId, 1);

  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 3);
  assert.equal(ws.content_sources.length, 3);
});

test("a scheduled action is not duplicated by a later projection", async () => {
  const { actions, routes, projection } = setup();
  await publishRoute(routes);

  const before = await workspace(actions);
  const first = before.plans.find((p: any) => p.target.lesson_no === 1);
  await actions.request(owner, "POST", "/" + first.id + "/operations", {
    key: "reschedule-first-lesson",
    revision: first.revision,
    action: "reschedule",
    date: "2026-11-20",
  });

  await projection.onRoutePublished(owner, routeId, 1);

  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 3);
  const stillOne = ws.plans.filter((p: any) => p.target.lesson_no === 1);
  assert.equal(stillOne.length, 1);
  assert.equal(stillOne[0].start_date, "2026-11-20");
});

test("an archived lesson action is not resurrected", async () => {
  const { actions, routes, projection } = setup();
  await publishRoute(routes);

  const before = await workspace(actions);
  const second = before.plans.find((p: any) => p.target.lesson_no === 2);
  await actions.request(owner, "POST", "/" + second.id + "/operations", {
    key: "archive-second-lesson",
    revision: second.revision,
    action: "archive",
  });

  await projection.onRoutePublished(owner, routeId, 1);

  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 3);
  assert.equal(
    ws.plans.filter((p: any) => p.target.lesson_no === 2 && p.status !== "archived")
      .length,
    0,
  );
});

test("capacity exhaustion skips the whole projection instead of a prefix", async () => {
  const { repo, actions, routes } = setup();
  const filler = Array.from({ length: 999 }, (_, index) => ({
    id: "action-filler-" + index,
    title: "填充 " + index,
    period: "day",
    completion_mode: "check",
    target: null,
    status: "active",
    schema_version: 2,
    revision: 1,
    start_date: null,
    end_date: null,
    timezone: "Asia/Shanghai",
    created_at: day + "T00:00:00.000Z",
    updated_at: day + "T00:00:00.000Z",
  }));
  await repo.saveActionWorkspace({
    ...owner,
    data: {
      plans: filler,
      records: [],
      reviews: [],
      reports: [],
      claims: {},
      content_sources: [],
    } as any,
    version: 1,
  });

  await publishRoute(routes);

  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 999);
  assert.equal(ws.content_sources.length, 0);
});

test("an unknown published version projects nothing", async () => {
  const { actions, projection } = setup();
  await projection.onRoutePublished(owner, routeId, 99);
  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 0);
});

test("lesson topics are truncated to the action title limit", async () => {
  const { actions, routes } = setup();
  const longTopic = "课".repeat(1000);
  await publishRoute(
    routes,
    {
      document: {
        ...document,
        lessons: [
          lesson(1, longTopic, "lesson"),
          lesson(2, "第二课", "lesson"),
          lesson(3, "复习课", "review"),
        ],
      },
    },
    "plan-route-projection-long",
  );

  const ws = await workspace(actions);
  assert.equal(ws.plans[0].title.length, 160);
});

test("projected lessons can be scheduled immediately because sources are seeded", async () => {
  const { actions, routes } = setup();
  await publishRoute(routes);

  const scheduled = (await actions.request(owner, "POST", "/schedules", {
    title: "计划 · 第一课",
    target: { kind: "plan", plan_id: routeId, lesson_no: 1 },
    date: day,
    timezone: "Asia/Shanghai",
    estimated_minutes: 20,
    key: "schedule-projected-lesson",
  })) as any;

  const ws = await workspace(actions);
  assert.equal(ws.plans.length, 4);
  assert.equal(scheduled.existing, false);
  assert.equal(scheduled.plan.target.lesson_no, 1);
});

test("a failing projection never fails the publish itself", async () => {
  const { learning, routes } = setup();
  await routes.save(
    owner,
    routeId,
    { base_revision: 0, brief, document },
    "route-save-throwing",
  );
  learning.routePublishedSink = async () => {
    throw new Error("projection exploded");
  };

  const published = await routes.publish(
    owner,
    routeId,
    { base_revision: 1 },
    "route-publish-throwing",
  );
  assert.equal(published.published_version, 1);
  assert.equal(published.status, "active");
});

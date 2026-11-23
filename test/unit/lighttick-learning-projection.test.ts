import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { LearningActionProjection } from "../../src/modules/lighttick/learning/learning-action-projection.ts";

const owner = { appId: "lighttick" as const, userId: "projection-alice" };
const routeId = "plan-projection-route";
const lessonId = "lesson-projection-1";
const contentVersion = "cv-1";
const day = "2026-11-16";

function clock() {
  return new Date(day + "T08:00:00Z");
}

function setup() {
  const repo = new InMemoryLightTickRepository();
  const actions = new ActionService(repo, clock, undefined, true);
  const projection = new LearningActionProjection(actions, repo.learningRoutes, clock);
  return { repo, actions, projection };
}

async function seedLink(repo: InMemoryLightTickRepository, lesson: string) {
  await repo.learningRoutes.insertRouteLessonLink({
    ...owner,
    routeId,
    number: 1,
    lessonId: lesson,
    routeVersion: 1,
    firstContentVersion: contentVersion,
  });
}

async function seedContentSource(repo: InMemoryLightTickRepository) {
  await repo.saveActionWorkspace({
    ...owner,
    data: {
      plans: [],
      records: [],
      reviews: [],
      reports: [],
      claims: {},
      content_sources: [{ kind: "plan", plan_id: routeId, lesson_no: 1 }],
    },
    version: 1,
  });
}

async function scheduleContentAction(actions: ActionService) {
  return (await actions.request(owner, "POST", "/schedules", {
    title: "计划 · 第1课",
    target: { kind: "plan", plan_id: routeId, lesson_no: 1 },
    date: day,
    timezone: "Asia/Shanghai",
    target_minutes: 20,
    estimated_minutes: 20,
    key: "schedule-projection",
  })) as any;
}

test("completing a route lesson end-to-end reconciles its scheduled content action", async () => {
  const { repo, actions, projection } = setup();
  const learning = new NativeLearningService(repo, true, clock);

  await learning.saveCollection(
    owner,
    "course-projection",
    { base_revision: 0, title: "Course", archived: false },
    "projection-collection",
  );
  const lesson = await learning.publish(
    owner,
    lessonId,
    {
      base_revision: 0,
      collection_id: "course-projection",
      number: 1,
      title: "Lesson",
      content: "Body",
      references: "",
    },
    "projection-publish",
  );

  await seedLink(repo, lesson.id);
  await seedContentSource(repo);
  const scheduled = await scheduleContentAction(actions);
  const planId = scheduled.plan.id;

  learning.completionSink = (o, id, v) => projection.onLessonCompleted(o, id, v);
  await learning.privateCommand(
    owner,
    lesson.id,
    { content_version: lesson.content_version, base_revision: 0, action: "complete" },
    "projection-complete",
  );

  const ws = (await actions.readWorkspace(owner)).data;
  const plan = ws.plans.find((p: { id: string }) => p.id === planId);
  assert.equal(plan.status, "completed");
  assert.equal(ws.content_events.length, 1);
  assert.equal(ws.content_events[0].consumed_by, planId);
  assert.equal(ws.records.length, 1);
  assert.equal(ws.records[0].completion_effect, "complete");
  assert.ok(ws.records[0].source_event_id.startsWith("native-"));
});

test("completion without a route link leaves the action workspace untouched", async () => {
  const { repo, actions, projection } = setup();
  await seedContentSource(repo);
  await scheduleContentAction(actions);

  await projection.onLessonCompleted(owner, "lesson-without-route", "cv-x");

  const ws = (await actions.readWorkspace(owner)).data;
  assert.equal(ws.content_events, undefined);
  assert.equal(ws.plans[0].status, "active");
  assert.equal(ws.records.length, 0);
});

test("projection is idempotent and stores the event when no action is scheduled yet", async () => {
  const { repo, actions, projection } = setup();
  await seedLink(repo, lessonId);
  await seedContentSource(repo);

  await projection.onLessonCompleted(owner, lessonId, contentVersion);
  await projection.onLessonCompleted(owner, lessonId, contentVersion);

  const ws = (await actions.readWorkspace(owner)).data;
  assert.equal(ws.content_events.length, 1);
  assert.equal(ws.content_sources.length, 1);
  assert.equal(ws.records.length, 0);
  assert.equal(ws.content_events[0].consumed_by, undefined);
});

test("scheduling the action after completion reconciles the stored event", async () => {
  const { repo, actions, projection } = setup();
  await seedLink(repo, lessonId);
  await seedContentSource(repo);

  await projection.onLessonCompleted(owner, lessonId, contentVersion);

  const scheduled = await scheduleContentAction(actions);
  const planId = scheduled.plan.id;

  await actions.request(owner, "POST", "/" + planId + "/operations", {
    key: "reconcile-later",
    revision: scheduled.plan.revision,
    action: "reconcile-content",
  });

  const ws = (await actions.readWorkspace(owner)).data;
  assert.equal(ws.plans[0].status, "completed");
  assert.equal(ws.content_events[0].consumed_by, planId);
});
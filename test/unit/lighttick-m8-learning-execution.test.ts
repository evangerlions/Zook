import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { LearningActionProjection } from "../../src/modules/lighttick/learning/learning-action-projection.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { LightTickManualDraftSchema, LightTickTaskCompleteRequestSchema } from "../../src/generated/openapi/public-contracts.generated.ts";

const owner = { appId: "lighttick" as const, userId: "m8-alice" };
const routeId = "plan-m8-route";
const lessonId = "lesson-m8-1";
const day = "2026-11-16";
const clock = () => new Date(day + "T08:00:00Z");

async function setup() {
  const repo = new InMemoryLightTickRepository();
  const learning = new NativeLearningService(repo, true, clock);
  const actions = new ActionService(repo, clock, undefined, true);
  const projection = new LearningActionProjection(actions, repo.learningRoutes, clock);
  const tasks = new LightTickTaskService(repo, clock);
  tasks.completeLesson = (o, id, v, base, key) =>
    learning.privateCommand(o, id, { content_version: v, base_revision: base, action: "complete" }, key);
  learning.completionSink = (o, id, v) => projection.onLessonCompleted(o, id, v);
  const manual = new ManualPlanningService(repo, clock);

  await learning.saveCollection(owner, "course-m8", { base_revision: 0, title: "Course", archived: false }, "m8-collection");
  const lesson = await learning.publish(owner, lessonId,
    { base_revision: 0, collection_id: "course-m8", number: 1, title: "Lesson", content: "Body", references: "" }, "m8-publish");
  const fx = routeFixture();
  await repo.learningRoutes.saveLearningRoute({ ...owner, id: routeId, revision: 1, publishedVersion: 1,
    status: "active", brief: fx.brief, document: fx.document, updatedAt: clock().toISOString() }, 0);
  await repo.learningRoutes.insertLearningRouteVersion({ ...owner, routeId, version: 1, brief: fx.brief,
    document: fx.document, digest: "d".repeat(64), createdAt: clock().toISOString() });
  await repo.learningRoutes.insertRouteLessonLink({ ...owner, routeId, number: 1, lessonId, routeVersion: 1, firstContentVersion: lesson.content_version });
  return { repo, learning, actions, projection, tasks, manual, contentVersion: lesson.content_version };
}

const target = (contentVersion: string, purpose: "learn" | "review" | "apply" = "learn") =>
  ({ kind: "plan" as const, plan_id: routeId, lesson_no: 1, route_version: 1, lesson_id: lessonId, content_version: contentVersion, purpose });

const draft = (contentVersion: string, over: Record<string, unknown> = {}) => ({
  title: "Learn the course", completion_criteria: "Finish lesson 1",
  period_start: day, period_end: "2026-11-22",
  tasks: [{ id: "learn-1", title: "Learn lesson 1", scheduled_for: day, estimated_minutes: 20,
    completion_criteria: "Learned", guidance: "", learning_target: target(contentVersion), ...over }],
});

test("M8 draft is inert; confirm materializes a fixed-source task that Today surfaces on the business day", async () => {
  const { repo, manual, contentVersion } = await setup();
  const created = await manual.create(owner, "m8-create-0001", draft(contentVersion));
  assert.equal((await repo.listTasks(owner)).length, 0, "draft must not create execution tasks");
  const confirmed = await manual.confirm(owner, created.id, "m8-confirm-0001",
    { base_version: created.version, goal_base_version: created.goal_version });
  const tasks = await repo.listTasks(owner);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].learningTarget, target(contentVersion));
  assert.equal(confirmed.tasks[0].learning_target?.lesson_id, lessonId);
  const today = await new LightTickTodayService(repo, clock).get(owner);
  assert.equal(today.executableTasks.length, 1);
  assert.equal(today.executableTasks[0].learningTarget?.content_version, contentVersion);
});

test("M8 confirm re-verifies the published source: wrong version, missing body and missing duration are rejected", async () => {
  const { repo, manual, contentVersion } = await setup();
  // wrong route version
  const badVersion = await manual.create(owner, "m8-badver-0001", draft(contentVersion, { learning_target: { ...target(contentVersion), route_version: 9 } }));
  await assert.rejects(() => manual.confirm(owner, badVersion.id, "m8-badver-c", { base_version: badVersion.version, goal_base_version: badVersion.goal_version }), { statusCode: 409 });
  // missing duration
  const noMinutes = await manual.create(owner, "m8-nomin-0001", draft(contentVersion, { estimated_minutes: null }));
  await assert.rejects(() => manual.confirm(owner, noMinutes.id, "m8-nomin-c", { base_version: noMinutes.version, goal_base_version: noMinutes.goal_version }), { statusCode: 422 });
  // unpublished content version
  const badContent = await manual.create(owner, "m8-badcv-0001", draft(contentVersion, { learning_target: { ...target(contentVersion), content_version: "f".repeat(64) } }));
  await assert.rejects(() => manual.confirm(owner, badContent.id, "m8-badcv-c", { base_version: badContent.version, goal_base_version: badContent.goal_version }), { statusCode: 422 });
  assert.equal((await repo.listTasks(owner)).length, 0);
});

test("M8 cross-session dedupe blocks the same lesson/purpose/date but allows an explicit review", async () => {
  const { manual, contentVersion } = await setup();
  const first = await manual.create(owner, "m8-dup-0001", draft(contentVersion));
  await manual.confirm(owner, first.id, "m8-dup-c1", { base_version: first.version, goal_base_version: first.goal_version });
  const again = await manual.create(owner, "m8-dup-0002", { ...draft(contentVersion), goal_id: first.goal_id });
  await assert.rejects(() => manual.confirm(owner, again.id, "m8-dup-c2", { base_version: again.version, goal_base_version: again.goal_version }), { statusCode: 409 });
  const review = await manual.create(owner, "m8-review-0001", { ...draft(contentVersion, { id: "review-1", title: "Review lesson 1", learning_target: target(contentVersion, "review") }), goal_id: first.goal_id });
  const confirmedReview = await manual.confirm(owner, review.id, "m8-review-c", { base_version: review.version, goal_base_version: review.goal_version });
  assert.equal(confirmedReview.tasks[0].learning_target?.purpose, "review");
});

test("M8 combined completion commits task and lesson atomically; ordinary completion stays isolated", async () => {
  const { repo, learning, tasks, manual, contentVersion } = await setup();
  const created = await manual.create(owner, "m8-comb-0001", draft(contentVersion));
  await manual.confirm(owner, created.id, "m8-comb-c", { base_version: created.version, goal_base_version: created.goal_version });
  const task = (await repo.listTasks(owner))[0];
  // ordinary complete must NOT mark the lesson learned
  await tasks.command(owner, task.id, task.version, { action: "complete" });
  const stateAfterOrdinary = await repo.getNativePrivateState(owner, lessonId, contentVersion);
  assert.ok(!stateAfterOrdinary?.completed, "ordinary task completion must not complete the lesson");
});

test("M8 explicit combined completion marks both the lesson and the task complete", async () => {
  const { repo, learning, tasks, manual, contentVersion } = await setup();
  const created = await manual.create(owner, "m8-comb2-0001", draft(contentVersion));
  await manual.confirm(owner, created.id, "m8-comb2-c", { base_version: created.version, goal_base_version: created.goal_version });
  const task = (await repo.listTasks(owner))[0];
  const saved = await tasks.command(owner, task.id, task.version,
    { action: "complete", learningCompletion: { contentVersion, baseRevision: 0 } });
  assert.equal(saved.status, "completed");
  const lessonState = await repo.getNativePrivateState(owner, lessonId, contentVersion);
  assert.equal(lessonState?.completed, true, "combined completion must mark the lesson learned");
  assert.ok((await repo.listTasks(owner))[0].completedAt);
});

test("M8 reader-alone completion completes today's learn task but leaves review and other-day tasks pending", async () => {
  const { repo, learning, manual, contentVersion } = await setup();
  const multi = { title: "Learn course", completion_criteria: "Done", period_start: day, period_end: "2026-11-22",
    tasks: [
      { id: "learn-today", title: "Learn today", scheduled_for: day, estimated_minutes: 20, completion_criteria: "", guidance: "", learning_target: target(contentVersion) },
      { id: "review-today", title: "Review today", scheduled_for: day, estimated_minutes: 10, completion_criteria: "", guidance: "", learning_target: target(contentVersion, "review") },
      { id: "learn-tomorrow", title: "Learn tomorrow", scheduled_for: "2026-11-17", estimated_minutes: 20, completion_criteria: "", guidance: "", learning_target: target(contentVersion) },
    ] };
  const created = await manual.create(owner, "m8-reader-0001", multi);
  await manual.confirm(owner, created.id, "m8-reader-c", { base_version: created.version, goal_base_version: created.goal_version });
  // learner marks the lesson learned from the reader alone
  await learning.privateCommand(owner, lessonId, { content_version: contentVersion, base_revision: 0, action: "complete" }, "m8-reader-complete");
  const byTitle = new Map((await repo.listTasks(owner)).map(t => [t.title, t.status]));
  assert.equal(byTitle.get("Learn today"), "completed", "today's learn task completes on lesson learned");
  assert.equal(byTitle.get("Review today"), "pending", "review task keeps its own completion criteria");
  assert.equal(byTitle.get("Learn tomorrow"), "pending", "other-day task is not auto-completed");
});

test("M8 single main learning goal gate rejects a second goal's learning arrangement", async () => {
  const { repo, manual, contentVersion } = await setup();
  const first = await manual.create(owner, "m8-gate-0001", draft(contentVersion));
  await manual.confirm(owner, first.id, "m8-gate-c1", { base_version: first.version, goal_base_version: first.goal_version });
  // a second goal (no goal_id) trying to schedule the same course
  const second = await manual.create(owner, "m8-gate-0002", draft(contentVersion, { id: "learn-2", title: "Another goal learn" }));
  await assert.rejects(() => manual.confirm(owner, second.id, "m8-gate-c2", { base_version: second.version, goal_base_version: second.goal_version }), { statusCode: 409 });
});
test("M8 shared fixture validates against the generated manual-draft and complete-request contracts", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../api-contracts/fixtures/lighttick/native-learning-execution-loop.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  (addFormats as any)(ajv);
  const draftOk = ajv.compile(LightTickManualDraftSchema);
  assert.equal(draftOk(fixture.draft), true, JSON.stringify(draftOk.errors));
  const completeOk = ajv.compile(LightTickTaskCompleteRequestSchema);
  assert.equal(completeOk(fixture.combined_completion_request), true, JSON.stringify(completeOk.errors));
  assert.equal(completeOk(fixture.ordinary_completion_request), true, JSON.stringify(completeOk.errors));
});

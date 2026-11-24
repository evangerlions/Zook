import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { LearningActionProjection } from "../../src/modules/lighttick/learning/learning-action-projection.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("Disposable synthetic localhost database required");

const owner = { appId: "lighttick" as const, userId: "m8-pg-" + process.pid };
const routeId = "plan-m8-pg-route";
const lessonId = "lesson-m8-pg-1";
const day = "2026-11-16";
const clock = () => new Date(day + "T08:00:00Z");
const target = (cv: string, purpose: "learn" | "review" | "apply" = "learn") =>
  ({ kind: "plan" as const, plan_id: routeId, lesson_no: 1, route_version: 1, lesson_id: lessonId, content_version: cv, purpose });
const draft = (cv: string, over: Record<string, unknown> = {}) => ({
  title: "Learn the course", completion_criteria: "Finish lesson 1", period_start: day, period_end: "2026-11-22",
  tasks: [{ id: "learn-1", title: "Learn lesson 1", scheduled_for: day, estimated_minutes: 20, completion_criteria: "Learned", guidance: "", learning_target: target(cv), ...over }],
});

test("M8 real PG: fixed-source scheduling, business-day Today, atomic combined completion and rollback", async () => {
  const database = await PostgresDatabase.create(dsn), pool = new Pool({ connectionString: dsn });
  const repo = new PostgresLightTickRepository(pool);
  const learning = new NativeLearningService(repo, true, clock);
  const actions = new ActionService(repo, clock, undefined, true);
  const projection = new LearningActionProjection(actions, repo.learningRoutes, clock);
  const tasks = new LightTickTaskService(repo, clock);
  tasks.completeLesson = (o, id, v, base, key) => learning.privateCommand(o, id, { content_version: v, base_revision: base, action: "complete" }, key);
  learning.completionSink = (o, id, v) => projection.onLessonCompleted(o, id, v);
  const manual = new ManualPlanningService(repo, clock);
  try {
    // the migration 151 column exists
    const col = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='zook_lighttick_tasks' AND column_name='learning_target'");
    assert.equal(col.rows.length, 1, "migration 151 must add learning_target");

    await learning.saveCollection(owner, "course-m8-pg", { base_revision: 0, title: "Course", archived: false }, "m8-pg-collection");
    const lesson = await learning.publish(owner, lessonId, { base_revision: 0, collection_id: "course-m8-pg", number: 1, title: "Lesson", content: "Body", references: "" }, "m8-pg-publish");
    const cv = lesson.content_version, fx = routeFixture();
    await repo.learningRoutes.saveLearningRoute({ ...owner, id: routeId, revision: 1, publishedVersion: 1, status: "active", brief: fx.brief, document: fx.document, updatedAt: clock().toISOString() }, 0);
    await repo.learningRoutes.insertLearningRouteVersion({ ...owner, routeId, version: 1, brief: fx.brief, document: fx.document, digest: "d".repeat(64), createdAt: clock().toISOString() });
    await repo.learningRoutes.insertRouteLessonLink({ ...owner, routeId, number: 1, lessonId, routeVersion: 1, firstContentVersion: cv });

    // draft inert; confirm persists learning_target into the real column
    const created = await manual.create(owner, "m8-pg-create-01", draft(cv));
    assert.equal((await repo.listTasks(owner)).length, 0);
    await manual.confirm(owner, created.id, "m8-pg-confirm-01", { base_version: created.version, goal_base_version: created.goal_version });
    const persisted = await pool.query("SELECT learning_target FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2", [owner.appId, owner.userId]);
    assert.equal(persisted.rows.length, 1);
    assert.equal(persisted.rows[0].learning_target.lesson_id, lessonId);
    assert.equal(persisted.rows[0].learning_target.content_version, cv);
    const today = await new LightTickTodayService(repo, clock).get(owner);
    assert.equal(today.executableTasks.length, 1);
    assert.equal(today.executableTasks[0].learningTarget?.content_version, cv);

    // cross-session dedupe on the same goal
    const again = await manual.create(owner, "m8-pg-create-02", { ...draft(cv), goal_id: created.goal_id });
    await assert.rejects(() => manual.confirm(owner, again.id, "m8-pg-confirm-02", { base_version: again.version, goal_base_version: again.goal_version }), { statusCode: 409 });

    // lost-response replay: the original confirm key replays the identical receipt
    const replay = await manual.confirm(owner, created.id, "m8-pg-confirm-01", { base_version: created.version, goal_base_version: created.goal_version });
    assert.equal(replay.tasks.length, 1);
    assert.equal(replay.tasks[0].learning_target?.lesson_id, lessonId);

    // concurrent confirm of the same lesson on a fresh date: exactly one wins, no duplicate task
    const raceA = await manual.create(owner, "m8-pg-race-a", { ...draft(cv, { id: "race-a", title: "Race A", scheduled_for: "2026-11-18" }), goal_id: created.goal_id });
    const raceB = await manual.create(owner, "m8-pg-race-b", { ...draft(cv, { id: "race-b", title: "Race B", scheduled_for: "2026-11-18" }), goal_id: created.goal_id });
    const results = await Promise.allSettled([
      manual.confirm(owner, raceA.id, "m8-pg-race-ca", { base_version: raceA.version, goal_base_version: raceA.goal_version }),
      manual.confirm(owner, raceB.id, "m8-pg-race-cb", { base_version: raceB.version, goal_base_version: raceB.goal_version }),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1, "concurrent same-lesson confirm must not double-book");

    // atomic combined completion: both facts land in PG
    const task = (await repo.listTasks(owner))[0];
    const saved = await tasks.command(owner, task.id, task.version, { action: "complete", learningCompletion: { contentVersion: cv, baseRevision: 0 } });
    assert.equal(saved.status, "completed");
    assert.equal((await repo.getNativePrivateState(owner, lessonId, cv))?.completed, true);

    // rollback: a fresh learn task whose lesson completion fails must not stay completed
    const created3 = await manual.create(owner, "m8-pg-create-04", { ...draft(cv, { id: "learn-4", title: "Learn next day", scheduled_for: "2026-11-17" }), goal_id: created.goal_id });
    await manual.confirm(owner, created3.id, "m8-pg-confirm-04", { base_version: created3.version, goal_base_version: created3.goal_version });
    const task3 = (await repo.listTasks(owner)).find(t => t.title === "Learn next day")!;
    const original = tasks.completeLesson!;
    tasks.completeLesson = async () => { throw Error("fixture lesson completion failure"); };
    try {
      await assert.rejects(() => tasks.command(owner, task3.id, task3.version, { action: "complete", learningCompletion: { contentVersion: cv, baseRevision: 0 } }), /fixture lesson completion failure/);
    } finally { tasks.completeLesson = original; }
    const rolledBack = (await repo.listTasks(owner)).find(t => t.id === task3.id)!;
    assert.equal(rolledBack.status, "pending", "task completion must roll back when lesson completion fails");

    // owner isolation
    assert.deepEqual(await new PostgresLightTickRepository(pool).listTasks({ ...owner, userId: "m8-pg-other" }), []);
  } finally {
    await pool.end(); await database.close?.();
  }
});
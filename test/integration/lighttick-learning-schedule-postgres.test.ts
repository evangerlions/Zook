import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats, { type FormatsPlugin } from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningContinuationService } from "../../src/modules/lighttick/learning/learning-continuation.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import {
  LightTickLearningScheduleEnvelopeSchema,
  LightTickLearningScheduledLessonEnvelopeSchema,
  LightTickLearningScheduleCompletionEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")) throw Error("A disposable local LightTick test database is required.");

test("HTTP handlers on PostgreSQL preserve scheduled lesson identity, atomic completion, and access", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const repo = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "user_alice" };
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) {
    seed.appUsers.push({ id: "schedule-fixture-" + userId, appId: "lighttick", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  }
  const app = await createApplication({ seed, lighttickEnabled: true, lighttickRepository: repo });
  const runtime = app.services.lighttickRuntime!;
  let now = new Date("2026-11-18T16:10:00Z");
  const clock = () => now;
  runtime.nativeLearning = new NativeLearningService(repo, true, clock);
  runtime.today = new LightTickTodayService(repo, clock);
  runtime.tasks = new LightTickTaskService(repo, clock);
  const routes = new LearningRouteService(runtime.nativeLearning);
  const ajv = new Ajv2020({ strict: false });
  (addFormats as unknown as FormatsPlugin)(ajv);
  const checkSchedule = ajv.compile(LightTickLearningScheduleEnvelopeSchema);
  const checkLesson = ajv.compile(LightTickLearningScheduledLessonEnvelopeSchema);
  const checkComplete = ajv.compile(LightTickLearningScheduleCompletionEnvelopeSchema);
  const call = (path: string, method = "GET", body?: unknown, key = "unused-fixture-key", user = owner.userId) =>
    app.app.handle({ path: "/api/v1/lighttick/" + path, method, body,
      headers: { "x-app-id": "lighttick", "idempotency-key": key, authorization: "Bearer " + app.services.tokenService.issueAccessToken(user, "lighttick") } });
  const data = <T = any>(result: Awaited<ReturnType<typeof call>>, status = 200): T => {
    assert.equal(result.statusCode, status, JSON.stringify(result.body));
    return (result.body as { data: T }).data;
  };
  const schema = (check: typeof checkSchedule, response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(check(JSON.parse(JSON.stringify(response.body))), true, JSON.stringify(check.errors));
    return data(response);
  };
  try {
    const timestamp = clock().toISOString();
    await repo.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
      onboardingState: "drafting", onboardingDraft: {}, notificationPreferences: {}, version: 1, createdAt: timestamp, updatedAt: timestamp });
    const goal = await runtime.goals.create(owner, { title: "Practice a concept", targetDate: "2027-01-01", constraints: {} });
    const otherGoal = await runtime.goals.create(owner, { title: "Another concept", constraints: {} });
    const routeId = "plan-schedule-fixture";
    await routes.save(owner, routeId, { ...routeFixture(), base_revision: 0 }, "schedule-save-route");
    await routes.publish(owner, routeId, { base_revision: 1 }, "schedule-publish-route");
    const authority = await runtime.nativeLearning.authority(owner);
    await runtime.nativeLearning.consent(owner, { base_revision: authority!.revision, reading_enabled: true, private_enabled: true }, "schedule-consent-enable");
    const first = await routes.publishLesson(owner, routeId, 1, { base_revision: 2, base_lesson_revision: 0,
      lesson_id: "lesson-first-fixture", content: "Pinned first lesson body." }, "schedule-publish-first");
    const proposed = { goal_id: goal.id, goal_base_version: goal.version, route_id: routeId, route_version: 1,
      period_start: "2026-11-19", period_end: "2026-11-25", available_daily_minutes: 90, available_weekly_minutes: 100,
      items: [{ id: "arrangement-first", lesson_number: 1, purpose: "learn", scheduled_for: "2026-11-19", estimated_minutes: 15 },
        { id: "arrangement-second", lesson_number: 2, purpose: "learn", scheduled_for: "2026-11-20", estimated_minutes: 20 }] };
    data(await call("learning/schedules", "POST", proposed, "schedule-without-body"), 422);
    await routes.publishLesson(owner, routeId, 2, { base_revision: 3, base_lesson_revision: 0,
      lesson_id: "lesson-second-fixture", content: "Second lesson body." }, "schedule-publish-second");
    data(await call("learning/schedules", "POST", { ...proposed, available_weekly_minutes: 30 }, "schedule-over-budget"), 422);
    data(await call("learning/schedules", "POST", { ...proposed, items: [proposed.items[1]] }, "schedule-without-prerequisite"), 422);
    const preview = schema(checkSchedule, await call("learning/schedules", "POST", proposed, "schedule-preview-original"));
    assert.deepEqual(preview.tasks, []);
    assert.equal((await repo.listTasks(owner)).length, 0);
    assert.deepEqual(data(await call("learning/schedules", "POST", proposed, "schedule-preview-original")), preview);
    data(await call("learning/schedules", "POST", { ...proposed, available_daily_minutes: 80 }, "schedule-preview-original"), 409);
    const confirm = { base_version: preview.version, goal_base_version: preview.goal_version };
    const confirmPath = "learning/schedules/" + preview.id + "/confirm";
    const confirmations = await Promise.all(Array.from({ length: 4 }, () => call(confirmPath, "POST", confirm, "schedule-confirm-original")));
    const confirmed = schema(checkSchedule, confirmations[0]);
    for (const response of confirmations) assert.deepEqual(data(response), confirmed);
    assert.equal(confirmed.tasks.length, 2);
    assert.equal((await repo.getGoal(owner, goal.id))?.targetDate, "2027-01-01");
    data(await call("learning/schedules", "POST", { ...proposed, goal_id: otherGoal.id, goal_base_version: otherGoal.version }, "schedule-other-goal"), 409);
    data(await call("learning/schedules/" + preview.id, "GET", undefined, "unused-key", "user_bob"), 404);
    const [firstTask, secondTask] = confirmed.tasks;
    const today = data(await call("today"));
    assert.equal(today.business_date, "2026-11-19");
    assert.deepEqual(today.tasks.map((task: any) => task.id), [firstTask.id]);
    assert.equal(today.tasks[0].lesson_source.content_version, first.content_version);
    const taskPath = "learning/scheduled-tasks/" + firstTask.id;
    const secondPath = "learning/scheduled-tasks/" + secondTask.id;
    assert.equal(schema(checkLesson, await call(taskPath)).lesson_source.lesson_id, first.id);
    data(await call(secondPath), 409);
    const command = { base_version: firstTask.version, lesson_id: first.id, content_version: first.content_version, completion_base_revision: 0 };
    const originalSave = repo.saveTask.bind(repo);
    try {
      repo.saveTask = async () => { throw Error("Injected task write failure"); };
      data(await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete"), 500);
    } finally {
      repo.saveTask = originalSave;
    }
    assert.equal((await runtime.nativeLearning.privateState(owner, first.id, first.content_version)).completed, false);
    assert.equal((await repo.getTask(owner, firstTask.id))?.status, "pending");
    const result = schema(checkComplete, await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete"));
    assert.equal(result.task.status, "completed");
    assert.equal(result.learning.completed, true);
    assert.deepEqual(data(await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete")), result);
    data(await call(taskPath + "/complete", "POST", command, "schedule-different-complete"), 409);
    assert.ok(data(await call(secondPath)).lesson_source);
    now = new Date("2026-11-19T16:10:00Z");
    assert.deepEqual(data(await call("today")).tasks.map((task: any) => task.id), [secondTask.id]);
    data(await call("tasks/" + secondTask.id + "/complete", "POST", { base_version: secondTask.version }, "schedule-task-only"));
    assert.equal((await runtime.nativeLearning.privateState(owner, secondTask.lesson_source.lesson_id, secondTask.lesson_source.content_version)).completed, false);
    const goalNow = (await repo.getGoal(owner, goal.id))!;
    const reviewDraft = { ...proposed, goal_base_version: goalNow.version,
      items: [{ ...proposed.items[0], purpose: "review", scheduled_for: "2026-11-20" }] };
    const review = schema(checkSchedule, await call("learning/schedules", "POST", reviewDraft, "schedule-review-draft"));
    const reviewPlan = schema(checkSchedule, await call("learning/schedules/" + review.id + "/confirm", "POST",
      { base_version: review.version, goal_base_version: review.goal_version }, "schedule-review-confirm"));
    const [reviewTask] = reviewPlan.tasks;
    data(await call("learning/schedules", "POST", { ...reviewDraft, goal_base_version: reviewPlan.goal_version },
      "schedule-review-duplicate"), 409);
    const rescheduled = data(await call("tasks/" + reviewTask.id + "/reschedule", "POST",
      { base_version: reviewTask.version, target_date: "2026-11-21" }, "schedule-move-review"));
    assert.equal(rescheduled.id, reviewTask.id);
    assert.equal(rescheduled.lesson_source.purpose, "review");
    assert.equal(rescheduled.scheduled_date, "2026-11-21");
    assert.equal((await repo.listTasks(owner)).length, 3);
    now = new Date("2026-11-20T16:10:00Z");
    assert.deepEqual(data(await call("today")).tasks.map((task: any) => task.id), [reviewTask.id]);
    const paused = await routes.transition(owner, routeId, { base_revision: 4, status: "paused" }, "schedule-pause-route");
    assert.deepEqual(data(await call("today")).tasks, []);
    data(await call("learning/scheduled-tasks/" + reviewTask.id), 409);
    await routes.transition(owner, routeId, { base_revision: paused.revision, status: "active" }, "schedule-resume-route");
    assert.deepEqual(data(await call("today")).tasks.map((task: any) => task.id), [reviewTask.id]);
    data(await call("tasks/" + reviewTask.id + "/complete", "POST", { base_version: rescheduled.version }, "schedule-review-complete"));
    assert.equal(data(await call("learning/routes/" + routeId + "/progress")).completed_lessons, 1);
    const next = await routes.publishLesson(owner, routeId, 1, { base_revision: paused.revision + 1, base_lesson_revision: 1,
      lesson_id: first.id, content: "A newer first lesson body." }, "schedule-publish-next-version");
    assert.notEqual(next.content_version, first.content_version);
    assert.equal(data(await call(taskPath)).lesson_source.content_version, first.content_version);
    assert.equal(data(await call("learning/routes/" + routeId + "/progress")).completed_lessons, 0);
    const stopped = schema(checkSchedule, await call("learning/schedules/" + preview.id + "/stop", "POST",
      { base_version: confirmed.version }, "schedule-stop-retain-history"));
    assert.equal(stopped.status, "superseded");
    assert.equal(stopped.tasks.filter((task: any) => task.status === "completed").length, 2);
    let queueAvailable = false;
    const enqueued: { date: string; id?: string; version?: number }[] = [];
    const continuation = new LearningContinuationService({
      repository: repo, native: () => runtime.nativeLearning, tasks: () => runtime.tasks,
      authorizeOwner: async candidate => candidate.userId === owner.userId, available: async () => true, clock,
      notifications: () => ({ enqueue: async (_owner, date, payload) => {
        if (!queueAvailable) return { queued: false };
        enqueued.push({ date, id: payload.resource_id, version: payload.expected_task_version });
        return { queued: true };
      } }),
    });
    runtime.learningContinuation = continuation;
    assert.equal(data(await call("learning/authority")).learning_continuation_enabled, true);
    const rolloverGoal = (await repo.getGoal(owner, goal.id))!;
    const rolloverInput = { ...proposed, goal_base_version: rolloverGoal.version, period_start: "2026-11-21",
      learning_continuation: { enabled: true, reminder_time: "09:00" },
      items: [{ ...proposed.items[0], id: "arrangement-rollover", scheduled_for: "2026-11-21" }] };
    const rollover = schema(checkSchedule, await call("learning/schedules", "POST", rolloverInput, "rollover-preview"));
    assert.deepEqual(rollover.draft.learning_continuation, rolloverInput.learning_continuation);
    assert.deepEqual(await repo.learningContinuations.list(owner), []);
    const rolloverPlan = schema(checkSchedule, await call("learning/schedules/" + rollover.id + "/confirm", "POST",
      { base_version: rollover.version, goal_base_version: rollover.goal_version }, "rollover-confirm"));
    const rolloverTask = rolloverPlan.tasks[0];
    assert.equal((await repo.learningContinuations.get(owner, rolloverTask.id))?.phase, "rollover");
    assert.ok(data(await call("today")).tasks.some((task: any) => task.id === rolloverTask.id));
    assert.deepEqual(await continuation.runBatch(), { moved: 0, adjusted: 0, enqueued: 0, failed: 0 });
    // Crossing midnight in the account zone does not depend on opening Today.
    now = new Date("2026-11-21T16:10:00Z");
    const batches = await Promise.all([continuation.runBatch(), continuation.runBatch()]);
    assert.equal(batches.reduce((sum, batch) => sum + batch.moved, 0), 1);
    assert.equal(batches.reduce((sum, batch) => sum + batch.failed, 0), 0);
    const moved = data(await call("today")).tasks.find((task: any) => task.id === rolloverTask.id);
    assert.equal(moved.scheduled_date, "2026-11-22");
    assert.equal(moved.learning_continued_from, "2026-11-21");
    assert.deepEqual(moved.lesson_source, rolloverTask.lesson_source);
    assert.equal(moved.version, rolloverTask.version + 1);
    assert.deepEqual(enqueued, []);
    now = new Date("2026-11-22T01:00:00Z");
    assert.deepEqual(await continuation.runBatch(), { moved: 0, adjusted: 0, enqueued: 0, failed: 0 });
    assert.equal((await repo.learningContinuations.get(owner, rolloverTask.id))?.phase, "reminder");
    queueAvailable = true;
    assert.equal((await continuation.runBatch()).enqueued, 1);
    assert.equal((await continuation.runBatch()).enqueued, 0);
    assert.deepEqual(enqueued, [{ date: "2026-11-22", id: moved.id, version: moved.version }]);
    const view = (await repo.getTask(owner, moved.id))!;
    assert.equal(await continuation.canDeliver(owner, view), true);
    now = new Date("2026-11-22T16:10:00Z");
    assert.equal((await continuation.runBatch()).moved, 0);
    const overdue = data(await call("today")).learning_needs_adjustment;
    assert.equal(overdue.find((task: any) => task.id === moved.id).learning_adjustment_reason, "already_continued");
    assert.equal(await continuation.canDeliver(owner, view), false, "The delivery fence expires with the account business day.");
    data(await call("learning/schedules/" + rollover.id + "/stop", "POST", { base_version: rolloverPlan.version }, "rollover-stop"));
    const lastDayGoal = (await repo.getGoal(owner, goal.id))!;
    const lastDay = schema(checkSchedule, await call("learning/schedules", "POST", {
      ...rolloverInput, goal_base_version: lastDayGoal.version, period_start: "2026-11-23", period_end: "2026-11-23",
      items: [{ ...proposed.items[0], id: "arrangement-last-day", scheduled_for: "2026-11-23" }],
    }, "rollover-last-day-preview"));
    const lastDayPlan = schema(checkSchedule, await call("learning/schedules/" + lastDay.id + "/confirm", "POST",
      { base_version: lastDay.version, goal_base_version: lastDay.goal_version }, "rollover-last-day-confirm"));
    now = new Date("2026-11-23T16:10:00Z");
    const lastDayTask = lastDayPlan.tasks[0];
    assert.deepEqual(await continuation.runBatch(), { moved: 0, adjusted: 1, enqueued: 0, failed: 0 });
    const lastDayAdjustment = data(await call("today")).learning_needs_adjustment.find((task: any) => task.id === lastDayTask.id);
    assert.equal(lastDayAdjustment.learning_adjustment_reason, "outside_plan");
    assert.equal(lastDayAdjustment.version, lastDayTask.version);
    assert.equal(lastDayAdjustment.scheduled_date, "2026-11-23");
    await runtime.nativeLearning.consent(owner, { base_revision: (await runtime.nativeLearning.authority(owner))!.revision, reading_enabled: false, private_enabled: false }, "schedule-consent-disable");
    assert.equal(await continuation.canDeliver(owner, view), false);
    assert.equal(data(await call("today")).learning_needs_adjustment, undefined);
    data(await call(taskPath), 403);
    data(await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete"), 403);
    await repo.deleteOwnerData(owner);
    assert.deepEqual(await repo.listTasks(owner), []);
    assert.deepEqual(await repo.learningContinuations.list(owner), []);
    assert.equal(await repo.getPlan(owner, preview.id), undefined);
    assert.equal(await repo.getOperation(owner, "schedule-atomic-complete"), undefined);
    assert.equal(await repo.getNativePrivateState(owner, first.id, first.content_version), undefined);
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

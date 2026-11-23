import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { Pool } from "pg";
import {
  LightTickLearningScheduleEnvelopeSchema, LightTickLearningScheduleUpcomingEnvelopeSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LearningContinuationService } from "../../src/modules/lighttick/learning/learning-continuation.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningSchedulingService } from "../../src/modules/lighttick/learning/learning-scheduling.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { createApplication } from "../support/create-test-application.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")) throw Error("A disposable local LightTick test database is required.");

test("reviewed course adjustments preserve lesson identity, retained dependencies, private progress and replay", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const repository = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick", userId: "user_alice" } as const;
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  const clock = () => new Date("2026-11-18T16:10:00Z");
  for (const userId of [owner.userId, "user_bob"])
    seed.appUsers.push({ id: "schedule-adjustment-" + userId, appId: owner.appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: clock().toISOString() });
  const application = await createApplication({ seed, lighttickEnabled: true, lighttickRepository: repository });
  const runtime = application.services.lighttickRuntime;
  runtime.nativeLearning = new NativeLearningService(repository, true, clock);
  runtime.tasks = new LightTickTaskService(repository, clock);
  let continuationAvailable = true;
  runtime.learningContinuation = new LearningContinuationService({
    repository, native: () => runtime.nativeLearning, tasks: () => runtime.tasks, clock,
    authorizeOwner: async candidate => candidate.userId === owner.userId, available: async () => continuationAvailable,
    notifications: () => ({ enqueue: async () => ({ queued: false }) }),
  });
  const service = new LearningSchedulingService(runtime.nativeLearning, runtime.tasks, async () => {}, async () => continuationAvailable);
  const routes = new LearningRouteService(runtime.nativeLearning);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const checkSchedule = ajv.compile(LightTickLearningScheduleEnvelopeSchema);
  const checkUpcoming = ajv.compile(LightTickLearningScheduleUpcomingEnvelopeSchema);
  const routeId = "plan-course-adjustment";
  let key = 0;
  const call = (path: string, method = "GET", body?: unknown, operation = "adjustment-fixture-" + (++key), userId = owner.userId as string) => {
    const url = new URL("/api/v1/lighttick/" + path, "http://127.0.0.1");
    return application.app.handle({ path: url.pathname, query: Object.fromEntries(url.searchParams), method, body, headers: {
      "x-app-id": owner.appId, "x-lighttick-task-schema": "2", "idempotency-key": operation,
      authorization: "Bearer " + application.services.tokenService.issueAccessToken(userId, owner.appId),
    } });
  };
  function schema(check: typeof checkSchedule, response: Awaited<ReturnType<typeof call>>) {
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.ok(check(JSON.parse(JSON.stringify(response.body))), JSON.stringify(check.errors));
    return (response.body as { data: any }).data;
  }
  const preview = (input: unknown) => call("learning/schedules", "POST", input);
  const confirm = (draft: any, operation?: string) => call("learning/schedules/" + draft.id + "/confirm", "POST",
    { base_version: draft.version, goal_base_version: draft.goal_version }, operation);
  try {
    const now = clock().toISOString();
    await repository.saveProfile({ ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
      onboardingState: "completed", onboardingDraft: {}, notificationPreferences: {}, version: 1, createdAt: now, updatedAt: now });
    const goal = await runtime.goals.create(owner, { title: "Practice a concept", constraints: {} });
    const route = routeFixture();
    route.brief.lesson_count = 3;
    route.document.lessons.push({ ...route.document.lessons[1], number: 3, topic: "Transfer", requires: [] });
    await routes.save(owner, routeId, { ...route, base_revision: 0 }, "adjustment-route-save");
    const published = await routes.publish(owner, routeId, { base_revision: 1 }, "adjustment-route-publish");
    const authority = await runtime.nativeLearning.authority(owner);
    await runtime.nativeLearning.consent(owner, { base_revision: authority!.revision, reading_enabled: true, private_enabled: true }, "adjustment-consent");
    const lessonIds = ["lesson-adjust-first", "lesson-adjust-second", "lesson-adjust-review"];
    for (const [index, lessonId] of lessonIds.entries()) {
      await routes.publishLesson(owner, routeId, index + 1, { base_revision: published.revision + index,
        base_lesson_revision: 0, lesson_id: lessonId, content: "Published adjustment fixture " + (index + 1) },
      "adjustment-publish-" + index);
    }
    const { publication } = await runtime.nativeLearning.publication(owner, lessonIds[2]);
    await runtime.nativeLearning.privateCommand(owner, lessonIds[2], { action: "save", base_revision: 0,
      content_version: publication.contentVersion, notes: "Private learning note preserved", answers: [] }, "adjustment-note");
    await runtime.nativeLearning.privateCommand(owner, lessonIds[2], { action: "complete", base_revision: 0,
      content_version: publication.contentVersion }, "adjustment-done");
    const preservedLearning = await runtime.nativeLearning.privateState(owner, lessonIds[2], publication.contentVersion);
    const schedule = {
      goal_id: goal.id, goal_base_version: goal.version, route_id: routeId, route_version: published.published_version,
      period_start: "2026-11-19", period_end: "2026-11-25", available_daily_minutes: 80, available_weekly_minutes: 140,
      items: [
        { id: "original-first", lesson_number: 1, purpose: "learn" as const, scheduled_for: "2026-11-20", estimated_minutes: 15 },
        { id: "original-second", lesson_number: 2, purpose: "learn" as const, scheduled_for: "2026-11-22", estimated_minutes: 20 },
        { id: "original-review", lesson_number: 3, purpose: "review" as const, scheduled_for: "2026-11-21", estimated_minutes: 10 },
      ],
    };
    const original = schema(checkSchedule, await confirm(schema(checkSchedule, await preview(schedule))));
    const originalTasks = original.tasks as { id: string; version: number; lesson_source: { lesson_number: number } }[];
    const [first, second, retained] = [1, 2, 3].map(number => originalTasks.find(task => task.lesson_source.lesson_number === number)!);
    const upcomingPath = "learning/schedules?" + new URLSearchParams({ goal_id: goal.id, route_id: routeId });
    const upcoming = () => call(upcomingPath).then(result => schema(checkUpcoming, result));
    assert.deepEqual((await upcoming()).items.map((item: { id: string }) => item.id), [first.id, retained.id, second.id]);
    assert.equal((await call(upcomingPath, "GET", undefined, "unused", "user_bob")).statusCode, 404);
    const ref = ({ id, version }: { id: string; version: number }) => ({ id, version });
    const moveFirst = { ...schedule.items[0], source_task_id: first.id, scheduled_for: "2026-11-22", estimated_minutes: 10 };
    const moveSecond = { ...schedule.items[1], source_task_id: second.id, scheduled_for: "2026-11-23", estimated_minutes: 12 };
    const batch = { ...schedule, goal_base_version: original.goal_version, available_daily_minutes: 25,
      replace_tasks: [ref(first), ref(second)], items: [moveFirst, moveSecond],
      learning_continuation: { enabled: true, reminder_time: "09:00" } };
    assert.equal((await preview({ ...batch, items: [], replace_tasks: [ref(first)] })).statusCode, 422);
    assert.equal((await preview({ ...batch, items: [moveFirst] })).statusCode, 422);
    assert.equal((await preview({ ...batch, items: [{ ...moveFirst, scheduled_for: "2026-11-19" }, moveSecond] })).statusCode, 422);
    assert.equal((await preview({ ...batch, available_daily_minutes: 10 })).statusCode, 422);
    assert.equal((await preview({ ...batch, replace_tasks: [ref(first)], items: [{ ...moveFirst, scheduled_for: "2026-11-23" }] })).statusCode, 409);
    assert.equal((await preview({ ...batch, replace_tasks: [{ ...ref(first), version: first.version + 1 }, ref(second)] })).statusCode, 409);
    assert.equal((await preview({ ...batch, items: [{ ...moveFirst, lesson_number: 2 }, moveSecond] })).statusCode, 422);

    const beforeReview = (await repository.listPlans(owner)).length;
    assert.equal((await service.review(owner, batch)).draft.tasks[0].source_task_id, first.id);
    assert.equal((await repository.listPlans(owner)).length, beforeReview);
    const reviewed = schema(checkSchedule, await preview(batch));
    assert.deepEqual(reviewed.replaced_tasks.map((task: { id: string }) => task.id).sort(), [first.id, second.id].sort());
    assert.deepEqual(reviewed.preserved_tasks.map((task: { id: string }) => task.id), [retained.id]);
    assert.deepEqual(reviewed.tasks, []);
    assert.equal((await repository.getTask(owner, first.id))?.status, "pending");
    continuationAvailable = false;
    assert.equal((await confirm(reviewed)).statusCode, 503);
    assert.equal((await repository.getTask(owner, second.id))?.status, "pending");
    continuationAvailable = true;

    const responses = await Promise.all([confirm(reviewed, "adjustment-confirm-shared"), confirm(reviewed, "adjustment-confirm-shared")]);
    const applied = schema(checkSchedule, responses[0]);
    assert.deepEqual(schema(checkSchedule, responses[1]), applied);
    assert.equal((await repository.getTask(owner, first.id))?.status, "cancelled");
    assert.equal((await repository.getTask(owner, second.id))?.status, "cancelled");
    assert.equal((await repository.getTask(owner, retained.id))?.status, "pending");
    assert.equal(applied.tasks.length, 2);
    assert.equal((await repository.getTask(owner, applied.tasks[0].id))?.lineageId, first.id);
    assert.equal((await repository.learningContinuations.get(owner, applied.tasks[0].id))?.reminderTime, "09:00");
    assert.deepEqual(await runtime.nativeLearning.privateState(owner, lessonIds[2], publication.contentVersion), preservedLearning);

    const single = { ...batch, goal_base_version: applied.goal_version, replace_tasks: [ref(applied.tasks[0])],
      items: [
        { ...moveFirst, source_task_id: applied.tasks[0].id, estimated_minutes: 9 },
        { ...schedule.items[2], id: "independent-practice", purpose: "apply", scheduled_for: "2026-11-24" },
      ] };
    const moved = schema(checkSchedule, await confirm(schema(checkSchedule, await preview(single))));
    assert.equal((await repository.getTask(owner, moved.tasks[0].id))?.lineageId, first.id);
    assert.equal((await repository.getTask(owner, moved.tasks[1].id))?.lineageId, moved.tasks[1].id);
    const nextFirst = moved.tasks[0];
    const stale = schema(checkSchedule, await preview({ ...single, goal_base_version: moved.goal_version,
      replace_tasks: [ref(nextFirst)], items: [{ ...moveFirst, source_task_id: nextFirst.id }] }));
    const started = await call("tasks/" + nextFirst.id + "/start", "POST", { base_version: nextFirst.version });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.equal((await confirm(stale)).statusCode, 409);
    assert.ok(!(await upcoming()).items.some((item: { id: string }) => item.id === nextFirst.id));

    const stalePublication = schema(checkSchedule, await preview({ ...batch, goal_base_version: moved.goal_version,
      replace_tasks: [ref(retained)], items: [{ ...schedule.items[2], source_task_id: retained.id, scheduled_for: "2026-11-25" }] }));
    const currentRoute = await routes.require(owner, routeId);
    await routes.publishLesson(owner, routeId, 3, { base_revision: currentRoute.revision, base_lesson_revision: 1,
      lesson_id: lessonIds[2], content: "A new version" }, "adjustment-republish");
    assert.equal((await confirm(stalePublication)).statusCode, 409);
    assert.ok(!(await upcoming()).items.some((item: { id: string }) => item.id === retained.id));
    assert.equal((await repository.getTask(owner, retained.id))?.status, "pending");
    assert.deepEqual(await runtime.nativeLearning.privateState(owner, lessonIds[2], publication.contentVersion), preservedLearning);
  } finally {
    try { await repository.deleteOwnerData(owner); } finally { await pool.end(); }
  }
});

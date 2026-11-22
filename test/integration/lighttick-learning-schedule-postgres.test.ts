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
import { CourseActionProjection } from "../../src/modules/lighttick/learning/course-action-projection.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import {
  LightTickLearningScheduleEnvelopeSchema,
  LightTickNativeLearningWorkEnvelopeSchema,
  LightTickLearningScheduledLessonEnvelopeSchema,
  LightTickLearningScheduleCompletionEnvelopeSchema,
  LightTickTutorObservationEnvelopeSchema,
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
  runtime.nativeLearning = new NativeLearningService(repo, true, clock, undefined, new CourseActionProjection(repo));
  runtime.today = new LightTickTodayService(repo, clock);
  runtime.tasks = new LightTickTaskService(repo, clock);
  const routes = new LearningRouteService(runtime.nativeLearning);
  let aiEnabled = false;
  runtime.learningWork = new LearningWorkService(routes, app.queue, () => aiEnabled);
  let suggested = { items: [{ lesson_number: 1, purpose: "learn", scheduled_for: "2026-11-19", estimated_minutes: 15 }] };
  let sent = "";
  let beforeReply: (() => Promise<void>) | undefined;
  const worker = new LearningWorkRunner(runtime.learningWork, {
    complete: async input => {
      sent = input.messages.at(-1)!.content as string;
      const messageInput = JSON.parse(sent.split("INPUT_JSON=").at(-1)!);
      const output = sent.includes("Teach one concept") ? {
        message:"两条可核对的事实。", next_step:"继续练习。", verdict:messageInput.action === "feedback" ? "supported" : "help",
        answer_quote:messageInput.action === "feedback" ? "9 条已核实" : "",
      } : suggested;
      const during = beforeReply;
      beforeReply = undefined;
      if (during) await during();
      return { text: JSON.stringify(output), provider: "synthetic", providerModel: "fixture" } as any;
    },
  }, { readFile: async () => { throw Error("No files expected"); }, fetchUrl: async () => { throw Error("No network material expected"); } });
  const ajv = new Ajv2020({ strict: false });
  (addFormats as unknown as FormatsPlugin)(ajv);
  const checkSchedule = ajv.compile(LightTickLearningScheduleEnvelopeSchema);
  const checkWork = ajv.compile(LightTickNativeLearningWorkEnvelopeSchema);
  const checkLesson = ajv.compile(LightTickLearningScheduledLessonEnvelopeSchema);
  const checkObservation = ajv.compile(LightTickTutorObservationEnvelopeSchema);
  const checkComplete = ajv.compile(LightTickLearningScheduleCompletionEnvelopeSchema);
  const call = (path: string, method = "GET", body?: unknown, key = "unused-fixture-key", user = owner.userId) =>
    app.app.handle({ path: "/api/v1/lighttick/" + path.split("?")[0], query: Object.fromEntries(new URLSearchParams(path.split("?")[1])), method, body,
      headers: { "x-app-id": "lighttick", "x-lighttick-task-schema": "2", "idempotency-key": key, authorization: "Bearer " + app.services.tokenService.issueAccessToken(user, "lighttick") } });
  const data = <T = any>(result: Awaited<ReturnType<typeof call>>, status = 200): T => {
    assert.equal(result.statusCode, status, JSON.stringify(result.body));
    return (result.body as { data: T }).data;
  };
  const schema = (check: typeof checkSchedule, response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(check(JSON.parse(JSON.stringify(response.body))), true, JSON.stringify({body:response.body,issues:check.errors}));
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
    const publishedActions = (await repo.getActionWorkspace(owner))!.data.plans;
    const authority = await runtime.nativeLearning.authority(owner);
    await runtime.nativeLearning.consent(owner, { base_revision: authority!.revision, reading_enabled: true, private_enabled: true }, "schedule-consent-enable");
    const first = await routes.publishLesson(owner, routeId, 1, { base_revision: 2, base_lesson_revision: 0,
      lesson_id: "lesson-first-fixture", content: "Pinned first lesson body.\n## 参考分析\n参考内容。" }, "schedule-publish-first", undefined, "structured-thinking-v1");
    const proposed = { goal_id: goal.id, goal_base_version: goal.version, route_id: routeId, route_version: 1,
      period_start: "2026-11-19", period_end: "2026-11-25", available_daily_minutes: 90, available_weekly_minutes: 100,
      items: [{ id: "arrangement-first", lesson_number: 1, purpose: "learn", scheduled_for: "2026-11-19", estimated_minutes: 15 },
        { id: "arrangement-second", lesson_number: 2, purpose: "learn", scheduled_for: "2026-11-20", estimated_minutes: 20 }] };
    data(await call("learning/schedules", "POST", proposed, "schedule-without-body"), 422);
    await routes.publishLesson(owner, routeId, 2, { base_revision: 3, base_lesson_revision: 0,
      lesson_id: "lesson-second-fixture", content: "Second lesson body." }, "schedule-publish-second");
    const savedPosition = { action:"position", content_version:first.content_version, base_revision:0, position:17 };
    data(await call("learning/lessons/"+first.id+"/private","POST",savedPosition,"schedule-reading-point"));
    const startup = now;
    now = new Date(+now + 7 * 86400000);
    const continuation = data(await call("learning/continuation?collection_id="+routeId));
    assert.equal(continuation.lesson_id, first.id);
    assert.equal(continuation.content_version, first.content_version);
    assert.equal(continuation.position,1);
    assert.equal(continuation.reading_position,17);
    now = startup;
    const { route_id, route_version: _routeVersion, items: _items, ...schedule } = proposed;
    const workInput = { kind: "schedule_draft", route_id, base_revision: 4, schedule };
    data(await call("learning/work", "POST", workInput, "suggestions-disabled"), 503);
    aiEnabled = true;
    const work = data(await call("learning/work", "POST", workInput, "schedule-suggestion"));
    await worker.execute(owner, work.id);
    const resultWork = schema(checkWork, await call("learning/work/" + work.id));
    assert.equal(resultWork.status, "succeeded");
    assert.equal(resultWork.output.suggestion.items[0].lesson_number, 1);
    assert.ok(sent.includes(first.content_version), "The worker receives only the pinned course catalog.");
    const oldSchedule = data(await call("learning/work", "POST", workInput, "schedule-before-revocation"));
    const reportPath = "learning/lessons/" + first.id + "/report-practice";
    const oldReport = data(await call(reportPath, "POST", {
      content_version: first.content_version, submission: "Only a synthetic report for revocation.", consent: true,
    }, "report-before-revocation"));
    const beforeRevocation = (await repo.getLearningAuthority(owner))!;
    await runtime.nativeLearning.consent(owner, { base_revision: beforeRevocation.revision, reading_enabled: true, private_enabled: false }, "private-revoke");
    const afterRevocation = (await repo.getLearningAuthority(owner))!;
    await runtime.nativeLearning.consent(owner, { base_revision: afterRevocation.revision, reading_enabled: true, private_enabled: true }, "private-reenable");
    const lastPrompt = sent;
    for (const stale of [oldSchedule, oldReport]) {
      const terminal = await worker.execute(owner, stale.id);
      assert.equal(terminal?.status, "failed");
      assert.equal(terminal?.errorCode, "LEARNING_CONTEXT_STALE");
      assert.equal(sent, lastPrompt, "Work queued under revoked consent cannot reach the model.");
    }
    assert.deepEqual(await repo.listTasks(owner), []);
    for (const [key, item] of [
      ["suggestion-invented-source", { ...suggested.items[0], lesson_number: 99 }],
      ["suggestion-over-budget", { ...suggested.items[0], estimated_minutes: 120 }],
    ] as const) {
      suggested = { items: [item] };
      const invalidWork = data(await call("learning/work", "POST", workInput, key));
      await worker.execute(owner, invalidWork.id);
      const rejected = data(await call("learning/work/" + invalidWork.id));
      assert.equal(rejected.status, "failed");
      assert.equal(rejected.error_code, "LEARNING_OUTPUT_INVALID");
    }
    assert.deepEqual(await repo.listTasks(owner), []);
    aiEnabled = false;
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
    assert.deepEqual(confirmed.tasks.map((task: any) => task.lesson_source.action_id), publishedActions.map(action => action.id));
    assert.equal((await repo.getActionWorkspace(owner))?.data.plans.length, 2);
    assert.equal((await repo.getActionWorkspace(owner))?.data.plans[0].start_date, "2026-11-19");
    const movePrerequisite = await call("tasks/" + firstTask.id + "/reschedule", "POST",
      { base_version: firstTask.version, target_date: "2026-11-21" }, "schedule-prerequisite-after-dependent");
    data(movePrerequisite, 409);
    assert.equal((await repo.getTask(owner, firstTask.id))?.version, firstTask.version);
    assert.equal((await repo.getTask(owner, firstTask.id))?.scheduledFor, "2026-11-19");
    const originalDay = now;
    now = new Date("2026-11-17T16:10:00Z");
    const futureReplacement = { ...proposed, goal_base_version: confirmed.goal_version, period_end: "2026-11-22",
      replace_tasks: [{ id: firstTask.id, version: firstTask.version }] };
    data(await call("learning/schedules", "POST", { ...futureReplacement,
      items: [{ ...proposed.items[0], scheduled_for: "2026-11-21" }] }, "schedule-review-prerequisite-after-dependent"), 409);
    data(await call("learning/schedules", "POST", { ...futureReplacement, items: [] }, "schedule-review-remove-prerequisite"), 409);
    assert.equal((await repo.getTask(owner, firstTask.id))?.version, firstTask.version);
    assert.equal((await repo.getTask(owner, secondTask.id))?.version, secondTask.version);
    now = originalDay;
    const today = data(await call("today"));
    assert.equal(today.business_date, "2026-11-19");
    assert.deepEqual(today.tasks.map((task: any) => task.id), [firstTask.id]);
    assert.equal(today.tasks[0].lesson_source.content_version, first.content_version);
    const taskPath = "learning/scheduled-tasks/" + firstTask.id;
    const secondPath = "learning/scheduled-tasks/" + secondTask.id;
    assert.equal(schema(checkLesson, await call(taskPath)).lesson_source.lesson_id, first.id);
    data(await call(secondPath), 409);
    data(await call("tasks/" + secondTask.id + "/start", "POST",
      { base_version: secondTask.version }, "schedule-start-without-prerequisite"), 409);
    now = new Date("2026-11-19T16:10:00Z");
    const blockedToday = data(await call("today"));
    assert.deepEqual(blockedToday.tasks, []);
    assert.equal(blockedToday.blocked_learning_tasks[0].task.id, secondTask.id);
    assert.equal(blockedToday.blocked_learning_tasks[0].reason, "prerequisite_incomplete");
    assert.equal(blockedToday.remaining_estimated_minutes, 0);
    assert.equal(blockedToday.snapshot_revision, today.snapshot_revision);
    now = new Date("2026-11-18T16:10:00Z");
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
    assert.equal(data(await call("today")).snapshot_revision, today.snapshot_revision);
    const result = schema(checkComplete, await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete"));
    assert.equal(result.task.status, "completed");
    assert.equal(result.learning.completed, true);
    assert.equal((await repo.getActionWorkspace(owner))?.data.plans[0].status, "completed");
    const afterComplete = data(await call("today"));
    assert.ok(BigInt(afterComplete.snapshot_revision) > BigInt(today.snapshot_revision));
    assert.deepEqual(data(await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete")), result);
    assert.equal(data(await call("today")).snapshot_revision, afterComplete.snapshot_revision);
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
    const pausedToday = data(await call("today"));
    assert.deepEqual(pausedToday.tasks, []);
    assert.equal(pausedToday.blocked_learning_tasks[0].reason, "route_paused");
    data(await call("learning/scheduled-tasks/" + reviewTask.id), 409);
    await routes.transition(owner, routeId, { base_revision: paused.revision, status: "active" }, "schedule-resume-route");
    assert.deepEqual(data(await call("today")).tasks.map((task: any) => task.id), [reviewTask.id]);
    data(await call("tasks/" + reviewTask.id + "/complete", "POST", { base_version: rescheduled.version }, "schedule-review-complete"));
    assert.equal(data(await call("learning/routes/" + routeId + "/progress")).completed_lessons, 1);
    const useGoal = (await repo.getGoal(owner, goal.id))!;
    const reviewBase = { ...proposed, goal_base_version: useGoal.version, period_start: "2026-11-21", period_end: "2026-11-27" };
    const application = { ...proposed.items[0], id: "apply-future-first", purpose: "apply", scheduled_for: "2026-11-22" };
    const applyDraft = schema(checkSchedule, await call("learning/schedules", "POST", { ...reviewBase, items: [application] }, "review-apply-new"));
    const apply = schema(checkSchedule, await call("learning/schedules/" + applyDraft.id + "/confirm", "POST",
      { base_version: applyDraft.version, goal_base_version: applyDraft.goal_version }, "review-apply-confirm")).tasks[0];
    const listPath = "learning/schedules?goal_id=" + goal.id + "&route_id=" + routeId;
    assert.equal(data(await call(listPath)).items[0].id, apply.id);
    const replacement = { ...reviewBase, goal_base_version: (await repo.getGoal(owner, goal.id))!.version,
      replace_tasks: [{id:apply.id, version:apply.version}],
      items: [{ ...application, scheduled_for:"2026-11-23", estimated_minutes:8, short_step:"只写一句含证据的概括" }] };
    const replacedDraft = schema(checkSchedule, await call("learning/schedules", "POST", replacement, "review-replacement"));
    assert.equal(replacedDraft.replaced_tasks[0].id, apply.id);
    assert.equal(replacedDraft.draft.tasks[0].guidance, "只写一句含证据的概括");
    assert.equal((await repo.getTask(owner, apply.id))!.status, "pending");
    const replacementPath = "learning/schedules/" + replacedDraft.id + "/confirm";
    const replace = { base_version: replacedDraft.version, goal_base_version: replacedDraft.goal_version };
    const accepted = await Promise.all(Array.from({length:3}, () => call(replacementPath,"POST",replace,"review-confirm-shared")));
    assert.deepEqual(accepted.map(value => data(value)), Array(3).fill(data(accepted[0])));
    const newTask = data(accepted[0]).tasks[0];
    assert.equal((await repo.getTask(owner, apply.id))!.status, "cancelled");
    const reduce = { ...reviewBase, goal_base_version: (await repo.getGoal(owner, goal.id))!.version,
      replace_tasks: [{id:newTask.id, version:newTask.version}], items: [] };
    const reducedDraft = schema(checkSchedule, await call("learning/schedules","POST",reduce,"review-reduce-only"));
    const reduced = schema(checkSchedule, await call("learning/schedules/" + reducedDraft.id + "/confirm","POST",
      {base_version:reducedDraft.version, goal_base_version:reducedDraft.goal_version},"review-reduce-confirm"));
    assert.deepEqual(reduced.tasks, []);
    assert.deepEqual(data(await call(listPath)).items, []);
    assert.equal((await repo.getTask(owner, firstTask.id))!.status,"completed");
    assert.equal((await repo.getTask(owner, newTask.id))!.status,"cancelled");

    aiEnabled = true;
    const lessonPath = "learning/lessons/" + first.id;
    const content_version = first.content_version;
    const observationPath = lessonPath + "/tutor-observation";
    const observation = () => call(observationPath + "?content_version=" + content_version);
    const question = "conclusion-and-two-facts-v1", concept = "conclusion-and-evidence-v1";
    data(await call(lessonPath+"/private","POST",{action:"save",base_revision:0,content_version,draft_version:content_version,
      notes:"这段笔记不应进入答疑",answers:[{id:question,prompt:"核对反馈",answer:"9 条已核实，另有 3 条待补。"}]},"observation-save"));
    const turn = {content_version,concept_id:concept,question_id:question,consent:true};
    const feedback = data(await call(lessonPath+"/tutor-work","POST",{...turn,action:"feedback",answer_revision:1},"observation-feedback"));
    await worker.execute(owner, feedback.id);
    assert.equal(schema(checkObservation, await observation()).status, "off");
    const allow = {action:"allow",content_version,base_revision:0,turn_id:feedback.id};
    assert.equal(data(await call(observationPath,"POST",allow,"observation-allow")).revision, 1);
    assert.equal(schema(checkObservation, await observation()).observation.turn_id, feedback.id);
    data(await call(observationPath,"POST",{action:"stop",content_version,base_revision:0},"observation-stale-stop"),409);
    data(await call(observationPath,"POST",{action:"correct",content_version,base_revision:1,correction:"我想练习结论句"},"observation-correct"));
    const contextual = data(await call(lessonPath+"/tutor-work","POST",{...turn,action:"ask",message:"再给个例子"},"observation-ask"));
    await worker.execute(owner,contextual.id);
    assert.match(sent,/我想练习结论句/);
    assert.doesNotMatch(sent,/这段笔记不应进入答疑/);
    const inFlight = data(await call(lessonPath+"/tutor-work","POST",{...turn,action:"ask",message:"请继续"},"observation-outdated"));
    beforeReply = async () => { data(await call(observationPath,"POST",{action:"stop",content_version,base_revision:2},"observation-stop")); };
    await worker.execute(owner,inFlight.id);
    assert.equal(data(await call("learning/work/"+inFlight.id)).error_code,"LEARNING_CONTEXT_STALE");
    assert.equal(schema(checkObservation, await observation()).status,"off");
    data(await call(observationPath,"POST",{...allow,base_revision:3},"observation-allow-again"));
    const savedTime = now;
    now = new Date(+now + 31 * 86400000);
    assert.equal(schema(checkObservation, await observation()).status,"unavailable");
    now = savedTime;
    const pinInput = { ...reviewBase, goal_base_version: (await repo.getGoal(owner, goal.id))!.version, items: [application] };
    const pinDraft = schema(checkSchedule, await call("learning/schedules", "POST", pinInput, "schedule-review-pin-old"));
    const pinPlan = schema(checkSchedule, await call("learning/schedules/" + pinDraft.id + "/confirm", "POST",
      { base_version: pinDraft.version, goal_base_version: pinDraft.goal_version }, "schedule-confirm-pin-old"));
    const pinned = pinPlan.tasks[0];
    const next = await routes.publishLesson(owner, routeId, 1, { base_revision: paused.revision + 1, base_lesson_revision: 1,
      lesson_id: first.id, content: "A newer first lesson body." }, "schedule-publish-next-version");
    assert.notEqual(next.content_version, first.content_version);
    const pinnedInput = { ...pinInput, goal_base_version: pinPlan.goal_version,
      replace_tasks: [{ id: pinned.id, version: pinned.version }],
      items: [{ ...application, scheduled_for: "2026-11-23" }] };
    const pinnedDraft = schema(checkSchedule, await call("learning/schedules", "POST", pinnedInput, "schedule-move-pinned-body"));
    assert.deepEqual(pinnedDraft.draft.tasks[0].lesson_source, pinned.lesson_source);
    const pinnedMove = schema(checkSchedule, await call("learning/schedules/" + pinnedDraft.id + "/confirm", "POST",
      { base_version: pinnedDraft.version, goal_base_version: pinnedDraft.goal_version }, "schedule-confirm-pinned-move"));
    assert.deepEqual(pinnedMove.tasks[0].lesson_source, pinned.lesson_source);
    assert.equal(pinnedMove.tasks[0].scheduled_date, "2026-11-23");

    assert.equal(schema(checkObservation, await observation()).status,"unavailable");
    assert.equal(data(await call(taskPath)).lesson_source.content_version, first.content_version);
    assert.equal(data(await call("learning/routes/" + routeId + "/progress")).completed_lessons, 0);
    const stopped = schema(checkSchedule, await call("learning/schedules/" + preview.id + "/stop", "POST",
      { base_version: confirmed.version }, "schedule-stop-retain-history"));
    assert.equal(stopped.status, "superseded");
    assert.equal(stopped.tasks.filter((task: any) => task.status === "completed").length, 2);
    const current = await runtime.nativeLearning.authority(owner);
    await runtime.nativeLearning.consent(owner, { base_revision: current!.revision, reading_enabled: false, private_enabled: false }, "schedule-consent-disable");
    data(await call(taskPath), 403);
    data(await call(taskPath + "/complete", "POST", command, "schedule-atomic-complete"), 403);
    await repo.deleteOwnerData(owner);
    assert.deepEqual(await repo.listTasks(owner), []);
    assert.equal(await repo.getPlan(owner, preview.id), undefined);
    assert.equal(await repo.getOperation(owner, "schedule-atomic-complete"), undefined);
    assert.equal(await repo.getNativePrivateState(owner, first.id, first.content_version), undefined);
    assert.equal(await repo.learningRoutes.work.tutorObservation(owner, first.id), undefined);
    const recordId = "record-outcome-fixture";
    data(await call("records/" + recordId, "PUT", {
      raw_text: "Keep an auditable result.", record_date: "2026-11-21", base_version: 0,
    }, "record-outcome-source"));
    const path = "records/" + recordId + "/outcomes";
    const goalBody = { kind: "goal", base_record_version: 1, title: "Goal from record" };
    const goalResponses = await Promise.all([1, 2].map(() => call(path, "POST", goalBody, "record-outcome-goal")));
    const goalReceipt = data(goalResponses[0], 201);
    assert.deepEqual(data(goalResponses[1], 201), goalReceipt);
    assert.equal((await repo.getGoal(owner, goalReceipt.id))?.status, "active");
    data(await call(path, "POST", { ...goalBody, title: "Different intent" }, "record-outcome-goal"), 409);
    data(await call(path, "POST", goalBody, "record-outcome-foreign", "user_bob"), 404);

    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const actionBody = { kind: "action", base_record_version: 1, title: "Action from record",
      goal_id: goalReceipt.id, scheduled_for: date, estimated_minutes: 15 };
    const plansBeforeFailure = (await repo.listPlans(owner)).length;
    const saveTask = repo.saveTask.bind(repo);
    try {
      repo.saveTask = async () => { throw Error("Injected outcome failure"); };
      data(await call(path, "POST", actionBody, "record-outcome-action"), 500);
    } finally {
      repo.saveTask = saveTask;
    }
    assert.equal((await repo.listPlans(owner)).length, plansBeforeFailure);
    const actionReceipt = data(await call(path, "POST", actionBody, "record-outcome-action"), 201);
    assert.deepEqual(data(await call(path, "POST", actionBody, "record-outcome-action"), 201), actionReceipt);
    assert.equal((await repo.getTask(owner, actionReceipt.id))?.scheduledFor, date);
    const previousToday = data(await call("today"));
    await pool.query("UPDATE zook_lighttick_plan_cycles SET status='superseded' WHERE app_id=$1 AND user_id=$2 AND status='active'", [owner.appId, owner.userId]);
    const cleared = data(await call("today"));
    assert.deepEqual(cleared.tasks, []);
    assert.ok(BigInt(cleared.snapshot_revision) > BigInt(previousToday.snapshot_revision));
    assert.ok(cleared.snapshot_version > previousToday.snapshot_version);
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

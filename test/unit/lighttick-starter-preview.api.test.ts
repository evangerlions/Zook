import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import {
  LightTickStarterPreviewRequestSchema, LightTickStarterPreviewSchema, LightTickStarterRequestSchema,
} from "../../src/generated/openapi/public-contracts.generated.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { createApplication } from "../support/create-test-application.ts";

const alice = { appId: "lighttick", userId: "user_alice" } as const;
const bob = { appId: "lighttick", userId: "user_bob" } as const;
const setupDay = "2026-09-06T16:30:00.000Z";
const businessDate = "2026-09-07";
const wish = "我想学编程";

async function setup() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const owner of [alice, bob]) seed.appUsers.push({
    ...owner, id: "starter-preview-" + owner.userId, status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: "2026-08-01T00:00:00.000Z",
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!;
  let now = new Date(setupDay);
  runtime.today = new LightTickTodayService(runtime.repository, () => now);
  const advance = (next: string) => { now = new Date(next); };
  async function call(path: string, method = "GET", body?: object, { user = alice.userId as string, key, token }:
    { user?: string | null; key?: string; token?: string } = {}) {
    if (token === undefined && user) token = app.services.tokenService.issueAccessToken(user, "lighttick");
    const result = await app.app.handle({
      method, path: "/api/v1/lighttick/" + path, body,
      headers: { ...(token ? { authorization: "Bearer " + token, "x-app-id": "lighttick" } : {}),
        ...(key ? { "idempotency-key": key } : {}) },
    });
    return { ...result, data: result.body.data as any };
  }
  return { runtime, call, advance };
}

test("starter preview is read-only and confirms the shown action in the saved account calendar", async () => {
  const { runtime, call } = await setup();
  const profile = await runtime.repository.saveProfile({ ...alice, timezone: "Asia/Shanghai", locale: "fr-FR",
    pace: "relaxed", notificationPreferences: { quiet_hours: true }, onboardingState: "completed",
    onboardingDraft: { goal_id: "previous-goal", valid_action_count: 8 }, version: 1,
    createdAt: setupDay, updatedAt: setupDay });
  const old = await runtime.goals.create(alice, { title: "原有目标", constraints: {} });
  const input = { wish: "练习把一段英文复述清楚", timezone: "UTC" };
  const preview = await call("onboarding/starter-preview", "POST", input);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers?.["Cache-Control"], "no-store");
  assert.equal(preview.data.timezone, "Asia/Shanghai");
  assert.equal(preview.data.business_date, businessDate);
  assert.equal(preview.data.can_schedule_today, true);
  assert.match(preview.data.preview_revision, /^[0-9a-f]{64}$/);
  assert.equal(preview.data.recommendation.title, "选一段短英文材料，用自己的话复述三句");
  assert.equal(preview.data.recommendation.completion_criteria, "留下三句英文复述，并标记一句还说不顺的地方");
  assert.deepEqual(await runtime.repository.listGoals(alice), [old]);
  assert.deepEqual(await runtime.repository.listPlans(alice), []);
  assert.deepEqual(await runtime.repository.listTasks(alice), []);
  assert.deepEqual(await runtime.repository.getProfile(alice), profile);

  const confirmed = await call("onboarding/starter", "POST", {
    ...input, preview_revision: preview.data.preview_revision, locale: "en-US",
  }, { key: "first-preview-confirmed" });
  assert.equal(confirmed.statusCode, 201);
  const action = confirmed.data.recommended;
  assert.deepEqual([action.title, action.estimated_duration_minutes, action.completion_criteria],
    [preview.data.recommendation.title, preview.data.recommendation.estimated_minutes, preview.data.recommendation.completion_criteria]);
  assert.equal(action.scheduled_date, businessDate);
  const plan = await runtime.repository.getPlan(alice, action.plan_id);
  assert.deepEqual([plan?.periodStart, plan?.periodEnd], [businessDate, businessDate]);
  assert.deepEqual(await runtime.repository.getProfile(alice), profile);
  assert.deepEqual(await runtime.repository.getGoal(alice, old.id), old);
  const today = await call("today");
  assert.equal(today.data.business_date, businessDate);
  assert.ok(today.data.tasks.some((task: { id: string }) => task.id === action.id));

  const legacy = await call("onboarding/starter", "POST", input, { user: bob.userId, key: "legacy-first-retelling-action" });
  assert.equal(legacy.statusCode, 201);
  assert.equal(legacy.data.recommended.title, `为“${input.wish}”写下第一个可验证的小结果`);
});

test("starter receipts reject other owners, changed input and past dates, and replay the accepted operation", async () => {
  const { runtime, call, advance } = await setup();
  const input = { wish, timezone: "Asia/Shanghai" };
  assert.equal((await call("onboarding/starter-preview", "POST", input, { user: null })).statusCode, 401);
  const preview = await call("onboarding/starter-preview", "POST", input);
  const command = { ...input, preview_revision: preview.data.preview_revision };
  for (const [body, user] of [[command, bob.userId], [{ ...command, wish: "另一个目标" }, alice.userId]] as const) {
    const rejected = await call("onboarding/starter", "POST", body, { user, key: "reviewed-starter-stale" });
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.body.code, "LIGHTTICK_VERSION_CONFLICT");
  }
  const invalid = await call("onboarding/starter", "POST", { ...command, preview_revision: false }, { key: "invalid-preview-revision" });
  assert.equal(invalid.statusCode, 400);
  advance("2026-09-07T16:30:00.000Z");
  const past = await call("onboarding/starter", "POST", command, { key: "yesterday-preview" });
  assert.equal(past.statusCode, 409);
  assert.equal(past.body.code, "LIGHTTICK_VERSION_CONFLICT");
  assert.deepEqual(await runtime.repository.listGoals(alice), []);
  assert.deepEqual(await runtime.repository.listGoals(bob), []);
  assert.equal(await runtime.repository.getProfile(alice), undefined);
  assert.equal(await runtime.repository.getProfile(bob), undefined);

  const current = await call("onboarding/starter-preview", "POST", input);
  const accepted = { ...input, preview_revision: current.data.preview_revision };
  const submit = () => call("onboarding/starter", "POST", accepted, { key: "same-preview-operation" });
  const responses = await Promise.all([submit(), submit()]);
  assert.equal(responses[0]?.statusCode, 201);
  assert.equal(responses[1]?.statusCode, 201);
  assert.deepEqual(responses[1]?.data, responses[0]?.data);
  assert.equal((await runtime.repository.listTasks(alice)).length, 1);
  assert.equal((await runtime.repository.getProfile(alice))?.timezone, input.timezone);
  assert.equal((await runtime.repository.getProfile(alice))?.onboardingDraft.task_id, responses[0]?.data.recommended.id);
  advance("2026-09-08T16:30:00.000Z");
  const replay = await submit();
  assert.equal(replay.statusCode, 201);
  assert.deepEqual(replay.data, responses[0]?.data);
});

test("starter review reports current restrictions and confirmation checks them under the write lock", async () => {
  const { runtime, call } = await setup();
  const input = { wish, timezone: "Asia/Shanghai" };
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: input.timezone }, { key: "starter-test-profile" })).statusCode, 200);
  const preview = () => call("onboarding/starter-preview", "POST", input);
  const first = await preview();
  assert.equal(first.data.can_schedule_today, true);
  const rest = (planned_rest: boolean, base_version: number, key: string) =>
    call("planning-calendar/rest", "PUT", { date: businessDate, planned_rest, base_version }, { key });
  const availability = (available_weekdays: number[] | null, base_version: number, key: string) =>
    call("planning-calendar/availability", "PUT", { available_weekdays, base_version }, { key });
  const budget = (weekly_available_minutes: number, base_version: number, key: string) =>
    call("planning-capacity", "PATCH", { weekly_available_minutes, base_version, plan_percent: 100 }, { key });
  assert.equal((await availability([6, 7], 0, "weekends-only")).statusCode, 200);
  assert.equal((await rest(true, 0, "rest-first-action")).statusCode, 200);
  assert.equal((await budget(0, 0, "no-time-first-action")).statusCode, 200);

  async function blocked(reason: string) {
    const view = await preview();
    assert.equal(view.statusCode, 200);
    assert.equal(view.data.can_schedule_today, false);
    assert.equal(view.data.blocking_code, reason);
    const result = await call("onboarding/starter", "POST", {
      ...input, preview_revision: first.data.preview_revision,
    }, { key: "preview-live-constraints" });
    assert.equal(result.statusCode, 422);
    assert.equal(result.body.code, reason);
    assert.deepEqual(await runtime.repository.listGoals(alice), []);
    assert.deepEqual(await runtime.repository.listPlans(alice), []);
    assert.deepEqual(await runtime.repository.listTasks(alice), []);
    assert.equal(await runtime.repository.getOperation(alice, "preview-live-constraints"), undefined);
  }
  await blocked("LIGHTTICK_PLANNED_REST_CONFLICT");
  assert.equal((await rest(false, 1, "resume-regular-date")).statusCode, 200);
  await blocked("LIGHTTICK_UNAVAILABLE_PLANNING_DAY");
  assert.equal((await availability(null, 1, "restore-every-day")).statusCode, 200);
  await blocked("LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  assert.equal((await budget(10, 1, "budget-for-one-action")).statusCode, 200);

  const sameWeekResults = await Promise.all(["final-review-first", "final-review-second"].map(key =>
    call("onboarding/starter", "POST", { ...input, preview_revision: first.data.preview_revision }, { key })));
  assert.deepEqual(sameWeekResults.map(result => result.statusCode).sort(), [201, 422]);
  assert.equal((await runtime.repository.listTasks(alice)).length, 1);
});

test("a guest can preview and confirm without changing the guest's existing profile", async () => {
  const { runtime, call } = await setup();
  const guest = await call("account/guest-sessions", "POST", {
    device_id: "starter-preview-browser-guest", device_secret: "starter-preview-guest-secret-at-least-32-bytes",
    platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN", app_version: "1.0.0",
  }, { user: null, key: "new-guest-starter-preview" });
  assert.equal(guest.statusCode, 201);
  const token = guest.data.access_token as string;
  const owner = { appId: "lighttick", userId: guest.data.user_id } as const;
  const setupProfile = await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" },
    { token, user: null, key: "guest-starter-profile" });
  assert.equal(setupProfile.statusCode, 200);
  const profile = await runtime.repository.getProfile(owner);
  assert.ok(profile);
  const input = { wish, timezone: "UTC" };
  const preview = await call("onboarding/starter-preview", "POST", input, { token, user: null });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.data.timezone, "Asia/Shanghai");
  assert.equal((await runtime.repository.listTasks(owner)).length, 0);
  const confirmed = await call("onboarding/starter", "POST", { ...input, preview_revision: preview.data.preview_revision },
    { token, user: null, key: "accepted-guest-first-action" });
  assert.equal(confirmed.statusCode, 201);
  assert.deepEqual(await runtime.repository.getProfile(owner), profile);
  assert.equal((await runtime.repository.listTasks(owner)).length, 1);
});

test("planning-first uses a saved goal's title and retains its session, prior plan and reflection", async () => {
  const { runtime, call, advance } = await setup();
  runtime.planningEnabled = true;
  const title = "练习把一段英文复述清楚";
  const sessionReply = await call("planning-sessions", "POST", { goal_title: title }, { key: "initial-goal-planning" });
  assert.equal(sessionReply.statusCode, 201);
  const session = sessionReply.data.session;
  const savedGoal = await runtime.repository.getGoal(alice, session.goal_id);
  assert.equal(savedGoal?.status, "draft");
  const goal = await runtime.goals.update(alice, savedGoal!.id, savedGoal!.version, {
    title, description: "原有说明", targetDate: "2026-09-12", constraints: { completion_criteria: "复述两个陌生题材" },
  });
  const existingPlan = await runtime.plans.createProposed(alice, {
    goalId: goal.id, granularity: "week", source: "ai", periodStart: businessDate, periodEnd: "2026-09-12",
    tasks: [{ title: "原有草案行动", estimatedMinutes: 8, scheduledFor: "2026-09-09" }],
  });
  const reflection = await call("reflections/prior-retelling-reflection", "PUT", {
    goal_id: goal.id, plan_id: existingPlan.id, content: "已有反思", next_action: "继续练习",
    base_version: 0, period_start: businessDate, period_end: businessDate,
  });
  assert.equal(reflection.statusCode, 200);
  const input = { goal_id: goal.id, timezone: "Asia/Shanghai" };
  const preview = await call("onboarding/starter-preview", "POST", { ...input, wish: "这不是目标标题" });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.data.goal_id, goal.id);
  assert.equal(preview.data.wish, title);
  assert.equal(preview.data.recommendation.title, "选一段短英文材料，用自己的话复述三句");
  assert.deepEqual(await runtime.repository.getGoal(alice, goal.id), goal);
  assert.deepEqual(await runtime.repository.listTasks(alice), []);

  const confirmation = { ...input, preview_revision: preview.data.preview_revision };
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  assert.equal(ajv.validate(LightTickStarterPreviewRequestSchema, input), true);
  assert.equal(ajv.validate(LightTickStarterPreviewSchema, preview.data), true);
  assert.equal(ajv.validate(LightTickStarterRequestSchema, confirmation), true);
  assert.equal(ajv.validate(LightTickStarterRequestSchema, input), false);
  assert.equal(ajv.validate(LightTickStarterRequestSchema, { ...input, wish: title }), false);
  assert.equal((await call("onboarding/starter", "POST", input, { key: "requires-actual-preview" })).body.code, "REQ_FIELD_REQUIRED");

  const keys = ["confirm-shared-goal-first", "confirm-shared-goal-second"];
  const submit = (key: string) => call("onboarding/starter", "POST", confirmation, { key });
  const results = await Promise.all(keys.map(submit));
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
  assert.equal(results.find(result => result.statusCode === 409)?.body.code, "LIGHTTICK_STARTER_EXISTS");
  const winnerIndex = results.findIndex(result => result.statusCode === 201);
  const winner = results[winnerIndex]!.data;
  assert.equal(winner.goal.id, goal.id);
  assert.equal(winner.goal.status, "active");
  assert.equal(winner.goal.version, goal.version + 1);
  assert.equal(winner.goal.target_date, goal.targetDate);
  assert.equal(winner.goal.description, goal.description);
  assert.deepEqual(winner.goal.constraints, goal.constraints);
  assert.equal((await runtime.repository.listGoals(alice)).length, 1);
  assert.equal((await runtime.repository.listTasks(alice)).length, 1);
  assert.deepEqual(await runtime.repository.getPlan(alice, existingPlan.id), existingPlan);
  assert.equal((await runtime.repository.listReflections(alice))[0]?.content, reflection.data.content);
  const { mode_recommendation: previousRecommendation, ...previousSession } = session;
  const { mode_recommendation: currentRecommendation, ...currentSession } = (await call("planning-sessions/" + session.id)).data;
  assert.equal(previousRecommendation.mode, "skill");
  assert.equal(currentRecommendation.mode, "deadline");
  assert.deepEqual(currentSession, previousSession);
  const disclosed = await call("onboarding/starter-preview", "POST", input);
  assert.equal(disclosed.data.blocking_code, "LIGHTTICK_STARTER_EXISTS");
  assert.equal(disclosed.data.existing_task_id, winner.recommended.id);

  advance("2026-09-07T16:30:00.000Z");
  const retry = await submit(keys[winnerIndex]!);
  assert.equal(retry.statusCode, 201);
  assert.deepEqual(retry.data, winner);
  const historical = await call("onboarding/starter-preview", "POST", input);
  assert.equal(historical.data.blocking_code, "LIGHTTICK_STARTER_EXISTS");
  assert.equal(historical.data.existing_task_id, undefined);
});

test("an existing generic starter remains a single action when followed by a planning session", async () => {
  const { runtime, call } = await setup();
  runtime.planningEnabled = true;
  const started = await call("onboarding/starter", "POST", { wish, timezone: "Asia/Shanghai" }, { key: "prior-generic-native-starter" });
  assert.equal(started.statusCode, 201);
  const goal = started.data.goal;
  const planning = await call("planning-sessions", "POST", { goal_id: goal.id }, { key: "existing-starter-goal-planning" });
  assert.equal(planning.statusCode, 201);
  assert.equal(planning.data.session.goal_id, goal.id);
  const input = { goal_id: goal.id, timezone: "Asia/Shanghai" };
  const preview = await call("onboarding/starter-preview", "POST", input);
  assert.equal(preview.data.blocking_code, "LIGHTTICK_STARTER_EXISTS");
  assert.equal(preview.data.existing_task_id, started.data.recommended.id);
  const complete = await call("tasks/" + started.data.recommended.id + "/complete", "POST",
    { base_version: started.data.recommended.version, actual_duration_minutes: 8 }, { key: "complete-prior-starter" });
  assert.equal(complete.statusCode, 200);
  const completedPreview = await call("onboarding/starter-preview", "POST", input);
  assert.equal(completedPreview.data.existing_task_id, started.data.recommended.id);
  const repeated = await call("onboarding/starter", "POST", { ...input, preview_revision: preview.data.preview_revision },
    { key: "duplicate-prior-starter" });
  assert.equal(repeated.statusCode, 409);
  assert.equal(repeated.body.code, "LIGHTTICK_STARTER_EXISTS");
  assert.equal((await runtime.repository.listTasks(alice)).length, 1);
  assert.equal((await runtime.repository.listGoals(alice)).length, 1);
});

test("goal-linked starter rejects foreign, closed, paused or revised goals without materializing actions", async () => {
  const { runtime, call } = await setup();
  const goal = await runtime.goals.create(alice, { title: wish, constraints: {} });
  const input = { goal_id: goal.id, timezone: "Asia/Shanghai" };
  const previous = await call("onboarding/starter-preview", "POST", input);
  const oldCommand = { ...input, preview_revision: previous.data.preview_revision };
  assert.equal((await call("onboarding/starter-preview", "POST", input, { user: bob.userId })).statusCode, 404);
  assert.equal((await call("onboarding/starter", "POST", oldCommand, { user: bob.userId, key: "foreign-goal-starter" })).statusCode, 404);
  const patched = await call("goals/" + goal.id, "PATCH", { base_version: goal.version, title: "练习短汇报" },
    { key: "rename-goal-before-first-action" });
  assert.equal(patched.statusCode, 200);
  const stale = await call("onboarding/starter", "POST", oldCommand, { key: "stale-goal-version" });
  assert.equal(stale.body.code, "LIGHTTICK_VERSION_CONFLICT");
  assert.deepEqual(await runtime.repository.listTasks(alice), []);

  const proposed = await runtime.plans.createProposed(alice, {
    goalId: goal.id, granularity: "day", source: "ai", periodStart: businessDate, periodEnd: businessDate,
    tasks: [{ title: "已有普通行动", estimatedMinutes: 7, scheduledFor: businessDate }],
  });
  await runtime.plans.confirm(alice, proposed.id, proposed.version);
  const active = await runtime.repository.getGoal(alice, goal.id);
  const next = await call("onboarding/starter-preview", "POST", input);
  assert.equal(next.data.can_schedule_today, true);
  const command = { ...input, preview_revision: next.data.preview_revision };
  let current = await runtime.goals.transition(alice, goal.id, active!.version, "pause");
  for (const status of ["paused", "archived"] as const) {
    assert.equal(current.status, status);
    const preview = await call("onboarding/starter-preview", "POST", input);
    assert.equal(preview.statusCode, 409);
    assert.equal(preview.body.code, "LIGHTTICK_STATE_TRANSITION_INVALID");
    const confirm = await call("onboarding/starter", "POST", command, { key: "stopped-first-action-" + status });
    assert.equal(confirm.statusCode, 409);
    assert.equal(confirm.body.code, "LIGHTTICK_STATE_TRANSITION_INVALID");
    if (status === "paused") current = await runtime.goals.transition(alice, goal.id, current.version, "archive");
  }
  assert.deepEqual((await runtime.repository.listTasks(alice)).map(task => task.title), ["已有普通行动"]);
});

test("goal-linked starter checks the fixed deadline and confirmed daily limit", async () => {
  const { runtime, call } = await setup();
  const deadline = await runtime.goals.create(alice, { title: wish, targetDate: "2026-09-06", constraints: {} });
  const daily = await runtime.goals.create(alice, { title: wish, targetDate: "2026-09-08", constraints: {} });
  const condition = await call("goals/" + daily.id + "/conditions", "POST", {
    base_version: daily.version, id: "starter-daily-reviewed", condition_version: 0, scope: "ongoing",
    starts_on: businessDate, ends_on: null, daily_minutes: 5, active: true, reason: "今天先留五分钟",
  }, { key: "starter-goal-daily-limit" });
  assert.equal(condition.statusCode, 200);
  for (const goal of [deadline, daily]) {
    const input = { goal_id: goal.id, timezone: "Asia/Shanghai" };
    const preview = await call("onboarding/starter-preview", "POST", input);
    assert.equal(preview.data.blocking_code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
    const confirm = await call("onboarding/starter", "POST", { ...input, preview_revision: preview.data.preview_revision },
      { key: "blocked-first-action-" + goal.id });
    assert.equal(confirm.statusCode, 422);
    assert.equal(confirm.body.code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  }
  assert.deepEqual(await runtime.repository.listTasks(alice), []);
  assert.equal((await runtime.repository.getGoal(alice, daily.id))?.status, "draft");
});

test("a linked first action respects shared capacity without rewriting an active goal or its ordinary work", async () => {
  const { runtime, call } = await setup();
  const goal = await runtime.goals.create(alice, { title: wish, constraints: { completion_criteria: "记录一个完成的作品" } });
  const ordinary = await runtime.plans.createProposed(alice, {
    goalId: goal.id, granularity: "day", source: "ai", periodStart: businessDate, periodEnd: businessDate,
    tasks: [{ title: "原有普通行动", estimatedMinutes: 4, scheduledFor: businessDate }],
  });
  const existing = await runtime.plans.confirm(alice, ordinary.id, ordinary.version);
  const previousGoal = await runtime.repository.getGoal(alice, goal.id);
  const input = { goal_id: goal.id, timezone: "Asia/Shanghai" };
  const initial = await call("onboarding/starter-preview", "POST", input);
  assert.equal(initial.data.can_schedule_today, true);
  const budget = (weekly_available_minutes: number, base_version: number) => call("planning-capacity", "PATCH",
    { weekly_available_minutes, base_version, plan_percent: 100 }, { key: "starter-existing-budget-" + base_version });
  assert.equal((await budget(13, 0)).statusCode, 200);
  const command = { ...input, preview_revision: initial.data.preview_revision };
  const confirmed = (key: string) => call("onboarding/starter", "POST", command, { key });
  const blocked = await confirmed("starter-existing-over-budget");
  assert.equal(blocked.statusCode, 422);
  assert.equal(blocked.body.code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  assert.deepEqual(await runtime.repository.listTasks(alice), existing.tasks);
  assert.equal((await budget(14, 1)).statusCode, 200);
  const accepted = await confirmed("starter-existing-at-budget");
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.data.goal.id, goal.id);
  assert.deepEqual(await runtime.repository.getGoal(alice, goal.id), previousGoal);
  assert.deepEqual(await runtime.repository.getTask(alice, existing.tasks[0]!.id), existing.tasks[0]);
  assert.equal((await runtime.repository.listTasks(alice)).length, 2);
});

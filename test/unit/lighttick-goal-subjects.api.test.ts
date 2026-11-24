import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickGoalSubjectEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { planningConditionContext } from "../../src/modules/lighttick/goal-context/confirmed-conditions.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { GOAL_SUBJECTS_KEY } from "../../src/modules/lighttick/planning/goal-subjects.ts";
import { assertWeeklyPlanningCapacity } from "../../src/modules/lighttick/planning/weekly-capacity.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-11-29T17:00:00Z");
const monday = "2026-11-30";
const sunday = "2026-12-06";
const reading = { id: "reading", title: "阅读", outcome_criteria: "写出主旨和两条依据", priority: "high", weekly_minutes: 25, archived: false };
const writing = { id: "writing", title: "写作", outcome_criteria: "交一份短文", priority: "normal", weekly_minutes: null, archived: false };
const emptyUsage = { known_minutes: 0, unknown_count: 0, pending_unknown_count: 0, remaining_minutes: 25, over_limit: false };
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateSubjects = ajv.compile(LightTickGoalSubjectEnvelopeSchema);

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "subjects-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-11-01T00:00:00Z",
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const { tokenService, lighttickRuntime } = app.services;
  const repository = lighttickRuntime.repository;
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  lighttickRuntime.tasks = new LightTickTaskService(repository, () => now);
  lighttickRuntime.plans = new LightTickPlanService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    options: { who?: string; key?: string } = {}) {
    const response = await app.app.handle({
      path: "/api/v1/lighttick/" + path, method, body, query: {}, headers: {
        authorization: "Bearer " + tokenService.issueAccessToken(options.who ?? owner.userId, appId),
        "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": options.key ?? "subjects-" + (++sequence),
      },
    });
    return { ...response, envelope: response.body as { code: string; data: any } };
  }
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" })).statusCode, 200);
  async function createGoal(title: string) {
    const response = await call("goals", "POST", { title, constraints: { legacy: true } });
    assert.equal(response.statusCode, 201);
    return response.envelope.data.id as string;
  }
  async function createScopedPlan(goalId: string, subjectId: string, title: string, minutes: number, date = monday) {
    const plan = await lighttickRuntime.plans.createProposed(owner, {
      goalId, granularity: "week", source: "ai", periodStart: monday, periodEnd: "2026-12-13",
      tasks: [{ title, estimatedMinutes: minutes, scheduledFor: date }], metadata: { subject_id: subjectId },
    });
    return lighttickRuntime.plans.confirm(owner, plan.id, plan.version);
  }
  return { repository, call, createGoal, createScopedPlan };
}

test("subject definitions preserve legacy goals, enforce ownership and expose account-local versioned usage", async () => {
  const { repository, call, createGoal } = await fixture();
  const goalId = await createGoal("英语日常练习");
  const path = "goals/" + goalId + "/subjects";
  const empty = await call(path);
  assert.deepEqual(empty.envelope.data, { goal_id: goalId, version: 0, week: { starts_on: monday, ends_on: sunday }, subjects: [] });
  assert.equal(empty.headers?.["Cache-Control"], "no-store");
  assert.equal((await call(path, "GET", undefined, { who: "user_bob" })).statusCode, 404);
  const initial = { base_version: 0, subjects: [reading, writing] };
  for (const subjects of [[reading, reading], [{ ...reading, weekly_minutes: -1 }], [{ ...reading, outcome_criteria: " " }]]) {
    assert.equal((await call(path, "PATCH", { base_version: 0, subjects })).statusCode, 400);
  }
  const saved = await call(path, "PATCH", initial, { key: "subject-first-write" });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(validateSubjects(saved.body), true, JSON.stringify(validateSubjects.errors));
  assert.deepEqual(saved.envelope.data.subjects[0], { ...reading, usage: emptyUsage, latest_outcome: null });
  assert.deepEqual((await call(path, "PATCH", initial, { key: "subject-first-write" })).envelope.data, saved.envelope.data);
  assert.equal((await call(path, "PATCH", initial)).envelope.code, "LIGHTTICK_VERSION_CONFLICT");
  assert.equal((await call(path, "PATCH", initial, { who: "user_bob" })).statusCode, 404);
  const goal = await repository.getGoal(owner, goalId);
  const ordinaryPatch = await call("goals/" + goalId, "PATCH", { base_version: goal!.version, constraints: { legacy: false } });
  assert.equal(ordinaryPatch.statusCode, 200, JSON.stringify(ordinaryPatch.body));
  assert.equal((await call(path)).envelope.data.version, 1);
  const forbidden = await call("goals/" + goalId, "PATCH", {
    base_version: ordinaryPatch.envelope.data.version, constraints: { [GOAL_SUBJECTS_KEY]: { schema_version: 1, version: 2, subjects: [] } },
  });
  assert.equal(forbidden.statusCode, 422);
  assert.deepEqual(await repository.listPlans(owner), []);
  assert.deepEqual(await repository.listTasks(owner), []);
});

test("subject usage follows actual completion, and evidence is explicit, replayable and scoped to an action", async () => {
  const { repository, call, createGoal, createScopedPlan } = await fixture();
  const goalId = await createGoal("学习测试");
  const path = "goals/" + goalId + "/subjects";
  assert.equal((await call(path, "PATCH", { base_version: 0, subjects: [reading, writing] })).statusCode, 200);
  const a = (await createScopedPlan(goalId, reading.id, "读一篇", 20)).tasks[0]!;
  const b = (await createScopedPlan(goalId, writing.id, "写一段", 11)).tasks[0]!;
  assert.deepEqual((await call(path)).envelope.data.subjects.map((item: any) => item.usage.known_minutes), [20, 11]);
  const outcome = path + "/reading/outcomes";
  assert.equal((await call(outcome, "POST", { base_version: 1, note: "Pending", task_id: a.id })).statusCode, 404);
  assert.equal((await call("tasks/" + a.id + "/complete", "POST", { base_version: a.version, actual_duration_minutes: 7 })).statusCode, 200);
  assert.equal((await call("tasks/" + b.id + "/complete", "POST", { base_version: b.version, actual_duration_minutes: 10 })).statusCode, 200);
  const after = await call(path);
  assert.deepEqual(after.envelope.data.subjects[0].usage, { ...emptyUsage, known_minutes: 7, remaining_minutes: 18 });
  assert.equal(after.envelope.data.subjects[0].latest_outcome, null);
  assert.equal((await call(outcome, "POST", { base_version: 1, note: "Wrong subject", task_id: b.id })).statusCode, 404);
  const firstBody = { base_version: 1, note: "我能更快定位论据。", task_id: a.id };
  const first = await call(outcome, "POST", firstBody, { key: "subject-evidence-now" });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(validateSubjects(first.body), true, JSON.stringify(validateSubjects.errors));
  assert.deepEqual(first.envelope.data.subjects[0].latest_outcome, { note: firstBody.note, task_id: a.id, recorded_at: now.toISOString() });
  assert.deepEqual((await call(outcome, "POST", firstBody, { key: "subject-evidence-now" })).envelope.data, first.envelope.data);
  const second = await call(outcome, "POST", { base_version: 2, note: "主旨更清楚了。" });
  assert.deepEqual(second.envelope.data.subjects[0].outcome_history, [first.envelope.data.subjects[0].latest_outcome]);
  assert.equal((await call(path, "PATCH", { base_version: 3, subjects: [writing] })).statusCode, 409);
  assert.equal((await call(path, "PATCH", { base_version: 3, subjects: [{ ...reading, archived: true }, writing] })).statusCode, 200);
  assert.equal((await call(outcome, "POST", { base_version: 4, note: "New note after archival" })).envelope.code,
    "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE");
  assert.equal((await call(path)).envelope.data.subjects[0].usage.known_minutes, 7);
  const goal = await repository.getGoal(owner, goalId);
  const generationContext = planningConditionContext(goal!, {}, "Asia/Shanghai", now);
  assert.equal(Object.hasOwn(generationContext, GOAL_SUBJECTS_KEY), false);
  assert.deepEqual((await repository.listTasks(owner)).map(task => task.status), ["completed", "completed"]);
});

test("a subject limit works without an account limit and inferred subjects reject extra load after rescheduling", async () => {
  const { repository, call, createGoal, createScopedPlan } = await fixture();
  const goalId = await createGoal("训练计划");
  const path = "goals/" + goalId + "/subjects";
  assert.equal((await call(path, "PATCH", { base_version: 0, subjects: [reading, writing] })).statusCode, 200);
  await createScopedPlan(goalId, reading.id, "本周任务", 20);
  const tomorrow = "2026-12-07";
  const future = (await createScopedPlan(goalId, reading.id, "下周任务", 10, tomorrow)).tasks[0]!;
  assert.equal((await call("tasks/" + future.id + "/reschedule", "POST",
    { base_version: future.version, target_date: "2026-12-02" })).envelope.code, "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_EXCEEDED");
  assert.equal((await repository.getTask(owner, future.id))?.scheduledFor?.slice(0, 10), tomorrow);
  await assert.rejects(assertWeeklyPlanningCapacity(repository, owner,
    [{ scheduledFor: monday, estimatedMinutes: null, goalId, subjectId: reading.id }], { now }),
    (error: any) => error.code === "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_ESTIMATE_REQUIRED");
  await assertWeeklyPlanningCapacity(repository, owner, [{ scheduledFor: monday, estimatedMinutes: 5, goalId, subjectId: reading.id }], { now });
  await assertWeeklyPlanningCapacity(repository, owner, [{ scheduledFor: monday, estimatedMinutes: 45, goalId, subjectId: writing.id }], { now });
  assert.equal((await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 30, plan_percent: 100 })).statusCode, 200);
  await assert.rejects(assertWeeklyPlanningCapacity(repository, owner,
    [{ scheduledFor: monday, estimatedMinutes: 11, goalId, subjectId: writing.id }], { now }),
    (error: any) => error.code === "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
});

import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningCapacityEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const userId = "user_alice";
const owner = { appId, userId } as const;

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const id of [userId, "user_bob"]) seed.appUsers.push({
    id: "shared-capacity-" + id, appId, userId: id, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-11-01T00:00:00Z",
  });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime, tokenService } = application.services;
  const repository = lighttickRuntime.repository;
  let now = new Date("2026-11-23T00:30:00Z");
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  lighttickRuntime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;

  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    options: { key?: string; query?: HttpRequest["query"]; caller?: string } = {}) {
    const response = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method, query: options.query ?? {}, body, headers: {
        authorization: "Bearer " + tokenService.issueAccessToken(options.caller ?? userId, appId),
        "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": options.key ?? ("weekly-capacity-" + (++sequence)),
      },
    });
    return { ...response, envelope: response.body as { data: any; code: string } };
  }

  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningCapacityEnvelopeSchema);
  async function capacity(date?: string, caller = userId) {
    const result = await call("planning-capacity", "GET", undefined, { query: date ? { date } : {}, caller });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.headers?.["Cache-Control"], "no-store");
    assert.equal(validate(result.body), true, JSON.stringify(validate.errors));
    return result.envelope.data;
  }

  const saveBudget = (body: HttpRequest["body"], key?: string) => call("planning-capacity", "PATCH", body, { key });
  async function draft(title: string, minutes: number, date = "2026-11-24") {
    const response = await call("manual-plans", "POST", {
      title, completion_criteria: "One visible result", period_start: "2026-11-23", period_end: "2026-12-06",
      tasks: [{ id: "first-action", title: title + " exercise", scheduled_for: date, estimated_minutes: minutes, completion_criteria: "Done", guidance: "" }],
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    return response.envelope.data;
  }
  const confirm = (pending: { id: string; version: number; goal_version: number }) => call("manual-plans/" + pending.id + "/confirm", "POST", {
    base_version: pending.version, goal_base_version: pending.goal_version,
  });
  return { repository, call, capacity, saveBudget, draft, confirm, setNow: (value: string) => { now = new Date(value); } };
}

test("weekly planning capacity is opt-in, account-local, versioned and replayable", async () => {
  const { call, capacity, saveBudget, repository } = await fixture();
  const profile = await call("profile", "PATCH", { base_version: 0, timezone: "America/Los_Angeles" });
  assert.equal(profile.statusCode, 200, JSON.stringify(profile.body));
  assert.deepEqual((await capacity()).budget, { version: 0, weekly_available_minutes: null, plan_percent: 80 });
  assert.equal(await repository.getWeeklyPlanningBudget(owner), undefined);
  assert.equal((await capacity()).business_date, "2026-11-22");
  assert.equal((await capacity()).week.starts_on, "2026-11-16");
  assert.equal((await capacity()).week.ends_on, "2026-11-22");
  assert.equal((await capacity("2026-11-23")).week.starts_on, "2026-11-23");
  assert.equal((await capacity("2026-11-29")).week.ends_on, "2026-11-29");
  assert.equal((await call("planning-capacity", "GET", undefined, { query: { date: "2026-11-31" } })).statusCode, 400);
  assert.equal((await saveBudget({ base_version: 0, weekly_available_minutes: 10081 })).statusCode, 400);
  const body = { base_version: 0, weekly_available_minutes: 0 };
  const first = await saveBudget(body, "weekly-setup-replay");
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.envelope.data.week.limit_minutes, 0);
  assert.equal(first.envelope.data.week.remaining_minutes, 0);
  assert.deepEqual((await saveBudget(body, "weekly-setup-replay")).envelope.data, first.envelope.data);
  assert.equal((await saveBudget({ ...body, weekly_available_minutes: 1 }, "weekly-setup-replay")).envelope.code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  assert.equal((await saveBudget(body)).envelope.code, "LIGHTTICK_VERSION_CONFLICT");
  assert.equal((await capacity("2026-11-22", "user_bob")).budget.version, 0);
  const raised = await saveBudget({ base_version: 1, weekly_available_minutes: 73, plan_percent: 100 });
  assert.equal(raised.envelope.data.week.limit_minutes, 73);
  const disabled = await saveBudget({ base_version: 2, weekly_available_minutes: null });
  assert.deepEqual(disabled.envelope.data.budget, { version: 3, weekly_available_minutes: null, plan_percent: 100 });
  assert.equal(disabled.envelope.data.week.limit_minutes, null);
});

test("confirming competing goals shares capacity and never partially materializes rejected work", async () => {
  const { call, capacity, saveBudget, draft, confirm, repository } = await fixture();
  assert.equal((await saveBudget({ base_version: 0, weekly_available_minutes: 100 })).statusCode, 200);
  const first = await draft("First reporting plan", 60);
  const second = await draft("Second learning plan", 25);
  const both = await Promise.all([confirm(first), confirm(second)]);
  assert.deepEqual(both.map(result => result.statusCode).sort(), [200, 422]);
  const rejected = both.findIndex(result => result.statusCode === 422);
  const pending = [first, second][rejected]!;
  const admitted = both[1 - rejected]!.envelope.data.tasks[0];
  assert.equal(both[rejected]!.envelope.code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  assert.equal((await repository.getPlan(owner, pending.id))?.status, "proposed");
  assert.equal((await repository.getGoal(owner, pending.goal_id))?.status, "draft");
  assert.deepEqual((await repository.listTasks(owner)).map(task => task.id), [admitted.id]);
  assert.equal((await capacity("2026-11-29")).week.known_minutes, admitted.estimated_duration_minutes);
  assert.equal((await capacity("2026-11-30")).week.known_minutes, 0);
  const cancelled = await call("tasks/" + admitted.id + "/cancel", "POST", { base_version: admitted.version });
  assert.equal(cancelled.statusCode, 200, JSON.stringify(cancelled.body));
  assert.equal((await capacity("2026-11-29")).week.remaining_minutes, 80);
  assert.equal((await confirm(pending)).statusCode, 200);
});

test("completion facts can exceed a new limit and belong to their actual local week", async () => {
  const { call, capacity, saveBudget, draft, confirm, setNow } = await fixture();
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "America/Los_Angeles" })).statusCode, 200);
  const initial = await confirm(await draft("Study plan before opting in", 35, "2026-11-29"));
  const task = initial.envelope.data.tasks[0];
  assert.equal((await saveBudget({ base_version: 0, weekly_available_minutes: 0 })).statusCode, 200);
  const recovering = await confirm(await draft("A new recovery-week arrangement", 5));
  assert.equal(recovering.envelope.code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  setNow("2026-11-30T08:30:00Z");
  const completed = await call("tasks/" + task.id + "/complete", "POST", { base_version: task.version, actual_duration_minutes: 45 });
  assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
  assert.equal((await capacity("2026-11-29")).week.known_minutes, 0);
  const next = await capacity();
  assert.equal(next.business_date, "2026-11-30");
  assert.equal(next.week.known_minutes, 45);
  assert.equal(next.week.over_limit, true);
});

test("the legacy AI path requires a date under an opted-in budget because Today treats undated work as executable", async () => {
  const { call, capacity, repository, saveBudget } = await fixture();
  const goals = new LightTickGoalService(repository);
  const plans = new LightTickPlanService(repository);
  const goal = await goals.create(owner, { title: "Learn a skill", constraints: {} });
  const legacy = await plans.createProposed(owner, {
    goalId: goal.id, source: "deterministic_fixture", granularity: "week",
    periodStart: "2026-11-23", periodEnd: "2026-11-29", tasks: [{ title: "Undated legacy action", estimatedMinutes: 10 }],
  });
  assert.equal((await saveBudget({ base_version: 0, weekly_available_minutes: 0 })).statusCode, 200);
  const rejected = await call("plans/" + legacy.id + "/confirm", "POST", { base_version: legacy.version });
  assert.equal(rejected.statusCode, 422, JSON.stringify(rejected.body));
  assert.equal((await repository.listTasks(owner)).length, 0);
  assert.equal((await saveBudget({ base_version: 1, weekly_available_minutes: null })).statusCode, 200);
  const accepted = await call("plans/" + legacy.id + "/confirm", "POST", { base_version: legacy.version });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  assert.equal((await call("today")).envelope.data.tasks[0].title, "Undated legacy action");
  assert.equal((await capacity()).week.known_minutes, 0);
});

test("same-week replacement releases its previous reservation and unknown minutes stay visible", async () => {
  const { call, capacity, saveBudget, draft, confirm, setNow } = await fixture();
  assert.equal((await saveBudget({ base_version: 0, weekly_available_minutes: 100 })).statusCode, 200);
  const original = await draft("Learn a work skill", 70);
  const task = (await confirm(original)).envelope.data.tasks[0];
  const replacement = await call("manual-plans", "POST", {
    goal_id: original.goal_id, title: "Smaller arrangement", period_start: "2026-11-23", period_end: "2026-12-06",
    completion_criteria: "A result", replace_tasks: [{ id: task.id, version: task.version }],
    tasks: [{ id: "smaller-task", title: "Short practice", scheduled_for: "2026-11-25", estimated_minutes: 55,
      completion_criteria: "Done", guidance: "", source_task_id: task.id }],
  });
  assert.equal(replacement.statusCode, 200, JSON.stringify(replacement.body));
  const replaced = await confirm(replacement.envelope.data);
  assert.equal(replaced.statusCode, 200, JSON.stringify(replaced.body));
  assert.equal((await capacity()).week.known_minutes, 55);
  const smaller = replaced.envelope.data.tasks[0];
  const progress = await call("tasks/" + smaller.id + "/progress", "POST", {
    base_version: smaller.version, action: "record_partial", outcome: "Worked through notes",
  });
  assert.equal(progress.statusCode, 200, JSON.stringify(progress.body));
  assert.equal((await capacity()).week.pending_unknown_count, 1);
  assert.equal((await capacity()).week.remaining_minutes, null);
  const competing = await draft("Cross-goal new action", 15);
  assert.equal((await confirm(competing)).envelope.code, "LIGHTTICK_WEEKLY_CAPACITY_ESTIMATE_REQUIRED");
  setNow("2026-11-25T12:00:00Z");
  const completed = await call("tasks/" + smaller.id + "/complete", "POST", { base_version: progress.envelope.data.task.version, actual_duration_minutes: 48 });
  assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
  assert.equal((await capacity()).week.known_minutes, 48);
  assert.equal((await capacity()).week.pending_unknown_count, 0);
  assert.equal((await confirm(competing)).statusCode, 200);
});

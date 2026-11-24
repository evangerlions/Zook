import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningRestEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" };
const today = "2026-11-30";
const tomorrow = "2026-12-01";
const end = "2026-12-06";
const restPath = "planning-calendar/rest";

async function fixture() {
  let now = new Date("2026-11-29T16:30:00Z");
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"])
    seed.appUsers.push({ id: "rest-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString() });
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    options: { query?: HttpRequest["query"]; userId?: string | null; key?: string } = {}) {
    const userId = options.userId === undefined ? owner.userId : options.userId;
    const response = await app.handle({ path: "/api/v1/lighttick/" + path, method, query: options.query ?? {}, body, headers: {
      ...(userId ? { authorization: "Bearer " + tokenService.issueAccessToken(userId, appId) } : {}),
      "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": options.key ?? "planned-rest-" + (++sequence),
    } });
    const envelope = response.body as { data: any; code: string };
    return { ...response, ...envelope };
  }
  await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" });
  const get = (date: string, userId?: string | null) => call(restPath, "GET", undefined, { userId, query: { date } });
  const put = (date: string, planned_rest: boolean, base_version: number, key?: string) =>
    call(restPath, "PUT", { date, planned_rest, base_version }, { key });
  const draft = (...schedule: [string, number | null][]) => call("manual-plans", "POST", {
    title: "Ordinary goal", completion_criteria: "Learn one concept", period_start: today, period_end: end,
    tasks: schedule.map(([scheduled_for, estimated_minutes], index) =>
      ({ id: "planned-action-" + index, title: "Action " + index, scheduled_for, estimated_minutes, completion_criteria: "Saved output", guidance: "" })),
  });
  const confirm = (plan: { id: string; version: number; goal_version: number }) =>
    call("manual-plans/" + plan.id + "/confirm", "POST", { base_version: plan.version, goal_base_version: plan.goal_version });
  return { call, repository, get, put, draft, confirm, nextDay: () => { now = new Date("2026-11-30T16:30:00Z"); } };
}

test("rest versions, receipts and projections use each owner's account-local date", async () => {
  const { call, repository, get, put, nextDay } = await fixture();
  assert.deepEqual((await get(today)).data, { date: today, planned_rest: false, version: 0, scheduled_action_count: 0 });
  assert.equal((await get(today, null)).statusCode, 401);
  assert.equal((await get("2026-02-29")).statusCode, 400);
  assert.equal((await put("2026-11-29", true, 0)).statusCode, 422);
  const first = await put(today, true, 0, "record-rest-once");
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningRestEnvelopeSchema);
  assert.equal(validate(first.body), true, JSON.stringify(validate.errors));
  assert.deepEqual(first.data, { date: today, planned_rest: true, version: 1, scheduled_action_count: 0 });
  assert.deepEqual((await get(today, "user_bob")).data, { date: today, planned_rest: false, version: 0, scheduled_action_count: 0 });
  assert.equal((await call("today")).data.planned_rest, true);
  const agenda = await call("planning-agenda", "GET", undefined, { query: { starts_on: "2026-11-28", ends_on: today } });
  assert.deepEqual(agenda.data.rest_dates, [today]);
  assert.deepEqual(agenda.data.items, []);
  assert.equal((await put(today, false, 0)).code, "LIGHTTICK_VERSION_CONFLICT");
  const concurrent = await Promise.all([put(today, false, 1), put(today, false, 1)]);
  assert.deepEqual(concurrent.map(response => response.statusCode).sort(), [200, 409]);
  assert.deepEqual((await get(today)).data, { date: today, planned_rest: false, version: 2, scheduled_action_count: 0 });
  assert.equal((await call("today")).data.planned_rest, undefined);
  assert.equal((await call("planning-agenda", "GET", undefined, { query: { starts_on: today, ends_on: tomorrow } })).data.rest_dates, undefined);
  assert.equal((await put(today, false, 0, "record-rest-once")).code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  nextDay();
  assert.equal((await put(today, true, 2)).statusCode, 422);
  assert.deepEqual((await put(today, true, 0, "record-rest-once")).data, first.data);
  assert.equal((await repository.listTasks(owner)).length, 0);
});

test("new scheduled work and task moves respect planned rest before budget checks without changing existing work", async () => {
  const { call, repository, get, put, draft, confirm } = await fixture();
  const priorDraft = await draft([today, null], [tomorrow, 12]);
  assert.equal(priorDraft.statusCode, 200, JSON.stringify(priorDraft.body));
  const prior = await confirm(priorDraft.data);
  assert.equal(prior.statusCode, 200, JSON.stringify(prior.body));
  const [first, second] = prior.data.tasks;
  const firstBefore = await repository.getTask(owner, first.id);
  const marked = await put(today, true, 0);
  assert.equal(marked.statusCode, 200, JSON.stringify(marked.body));
  assert.equal(marked.data.scheduled_action_count, 1);
  assert.deepEqual(await repository.getTask(owner, first.id), firstBefore);
  const scheduled = await call("today");
  assert.equal(scheduled.data.planned_rest, true);
  assert.ok(scheduled.data.tasks.some((task: { id: string }) => task.id === first.id));

  const proposed = await draft([today, 30]);
  assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.body));
  const query = { plan_id: proposed.data.id, plan_version: String(proposed.data.version) };
  const preflight = () => call("planning-capacity/preview", "GET", undefined, { query });
  const preview = await preflight();
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.equal(preview.data.block_reason, "planned_rest");
  assert.deepEqual(preview.data.planned_rest_dates, [today]);
  assert.equal(preview.data.weeks[0].limit_minutes, null);
  const blockedPlan = await confirm(proposed.data);
  assert.equal(blockedPlan.statusCode, 422, JSON.stringify(blockedPlan.body));
  assert.equal(blockedPlan.code, "LIGHTTICK_PLANNED_REST_CONFLICT");
  assert.equal((await repository.getPlan(owner, proposed.data.id))?.status, "proposed");

  const legacyPlans = new LightTickPlanService(repository);
  const newWorkWithAnExistingId = { id: first.id, title: "Another action", scheduledFor: today, estimatedMinutes: 10 };
  const legacy = await legacyPlans.createProposed(owner, { goalId: prior.data.goal_id, granularity: "week", source: "ai",
    periodStart: today, periodEnd: end, tasks: [newWorkWithAnExistingId] });
  await assert.rejects(legacyPlans.confirm(owner, legacy.id, legacy.version), { code: "LIGHTTICK_PLANNED_REST_CONFLICT" });
  assert.equal((await repository.getPlan(owner, legacy.id))?.status, "proposed");

  const reschedule = (id: string, version: number) => call("tasks/" + id + "/reschedule", "POST", { base_version: version, target_date: today });
  const blockedMove = await reschedule(second.id, second.version);
  assert.equal(blockedMove.statusCode, 422);
  assert.equal(blockedMove.code, "LIGHTTICK_PLANNED_REST_CONFLICT");
  assert.equal((await repository.getTask(owner, second.id))?.scheduledFor, tomorrow);
  const estimated = await call("tasks/" + first.id + "/progress", "POST", { base_version: first.version,
    action: "set_remaining", remaining_estimated_minutes: 8 });
  assert.equal(estimated.statusCode, 200, JSON.stringify(estimated.body));
  const unchangedDate = await reschedule(first.id, estimated.data.task.version);
  assert.equal(unchangedDate.statusCode, 200, JSON.stringify(unchangedDate.body));
  const complete = await call("tasks/" + first.id + "/complete", "POST", {
    base_version: unchangedDate.data.version, actual_duration_minutes: 8,
  });
  assert.equal(complete.statusCode, 200, JSON.stringify(complete.body));
  assert.equal((await get(today)).data.scheduled_action_count, 1);

  const lowered = await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 20, plan_percent: 100 });
  assert.equal(lowered.statusCode, 200);
  const both = await preflight();
  assert.equal(both.data.weeks[0].blocking, "over_limit");
  assert.equal(both.data.block_reason, "planned_rest");
  assert.equal((await confirm(proposed.data)).code, "LIGHTTICK_PLANNED_REST_CONFLICT");
  assert.equal((await put(today, false, 1)).statusCode, 200);
  const cleared = await preflight();
  assert.equal(cleared.data.block_reason, "over_limit");
  assert.equal(cleared.data.planned_rest_dates, undefined);
  assert.equal((await repository.getTask(owner, first.id))?.status, "completed");
});

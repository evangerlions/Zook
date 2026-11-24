import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningAvailabilityEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" };
const now = new Date("2026-11-29T16:30:00Z");
const monday = "2026-11-30", tuesday = "2026-12-01", sunday = "2026-12-06";
const path = "planning-calendar/availability";

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) {
    seed.appUsers.push({ id: "weekday-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString() });
  }
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function call(route: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    { userId = owner.userId as string | null, query, key }: { userId?: string | null; query?: HttpRequest["query"]; key?: string } = {}) {
    const response = await app.handle({ path: "/api/v1/lighttick/" + route, method, query: query ?? {}, body, headers: {
      ...(userId ? { authorization: "Bearer " + tokenService.issueAccessToken(userId, appId) } : {}),
      "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": key ?? "weekday-" + (++sequence),
    } });
    return { ...response, ...response.body as { data: any; code: string } };
  }
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" })).statusCode, 200);
  const set = (available_weekdays: number[] | null, base_version: number, key?: string) =>
    call(path, "PUT", { available_weekdays, base_version }, { key });
  const createDraft = (dates: string[]) => call("manual-plans", "POST", {
    title: "Scheduled goal", completion_criteria: "Explain a concept", period_start: monday, period_end: sunday,
    tasks: dates.map((date, index) => ({ id: "weekday-action-" + index, title: "Practice " + index, scheduled_for: date,
      estimated_minutes: 10, completion_criteria: "One explanatory note", guidance: "" })),
  });
  const confirm = (plan: { id: string; version: number; goal_version: number }) =>
    call("manual-plans/" + plan.id + "/confirm", "POST", { base_version: plan.version, goal_base_version: plan.goal_version });
  return { call, set, createDraft, confirm, repository };
}

test("available weekdays are canonical, owner-scoped and distinguish empty from the default", async () => {
  const { call, set } = await fixture();
  const defaults = { available_weekdays: null, version: 0 };
  assert.deepEqual((await call(path)).data, defaults);
  assert.equal((await call(path, "GET", undefined, { userId: null })).statusCode, 401);
  for (const invalid of [[0], [8], [1.5], [2, 2], [1, 2, 3, 4, 5, 6, 7, 7]]) {
    assert.equal((await set(invalid, 0)).statusCode, 400);
  }
  assert.equal((await call(path, "PUT", { base_version: 0 })).statusCode, 400);
  const first = await set([7, 1, 3], 0, "same-weekday-write");
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningAvailabilityEnvelopeSchema);
  assert.equal(validate(first.body), true, JSON.stringify(validate.errors));
  assert.deepEqual(first.data, { available_weekdays: [1, 3, 7], version: 1 });
  assert.deepEqual((await call(path, "GET", undefined, { userId: "user_bob" })).data, defaults);
  assert.equal((await set([1, 3, 7], 0, "same-weekday-write")).code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  const race = await Promise.all([set([], 1), set([], 1)]);
  assert.deepEqual(race.map(value => value.statusCode).sort(), [200, 409]);
  assert.deepEqual((await call(path)).data, { available_weekdays: [], version: 2 });
  assert.equal((await call("today")).data.planning_day_unavailable, true);
  assert.deepEqual((await set([7, 1, 3], 0, "same-weekday-write")).data, first.data);
  assert.deepEqual((await set(null, 2)).data, { available_weekdays: null, version: 3 });
  assert.equal((await call("today")).data.planning_day_unavailable, undefined);
});

test("weekdays block only new dated work, use the owner's local day and respect explicit rest precedence", async () => {
  const { call, set, createDraft, confirm, repository } = await fixture();
  const previous = await createDraft([monday, tuesday]);
  assert.equal(previous.statusCode, 200, JSON.stringify(previous.body));
  const active = await confirm(previous.data);
  assert.equal(active.statusCode, 200, JSON.stringify(active.body));
  const [first, second] = active.data.tasks;
  const snapshot = await repository.getTask(owner, first.id);
  assert.equal((await set([2], 0)).statusCode, 200);
  const today = await call("today");
  assert.equal(today.data.business_date, monday);
  assert.equal(today.data.planning_day_unavailable, true);
  assert.deepEqual(today.data.tasks.map((task: { id: string }) => task.id), [first.id]);
  assert.deepEqual(await repository.getTask(owner, first.id), snapshot);
  const agenda = await call("planning-agenda", "GET", undefined, { query: { starts_on: "2026-11-28", ends_on: sunday } });
  assert.deepEqual(agenda.data.unavailable_dates, [monday, "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", sunday]);
  assert.deepEqual(agenda.data.items.map((task: { id: string }) => task.id), [first.id, second.id]);

  const proposal = await createDraft([monday]);
  assert.equal(proposal.statusCode, 200, JSON.stringify(proposal.body));
  const preview = () => call("planning-capacity/preview", "GET", undefined,
    { query: { plan_id: proposal.data.id, plan_version: String(proposal.data.version) } });
  const before = await preview();
  assert.equal(before.statusCode, 200, JSON.stringify(before.body));
  assert.equal(before.data.weeks[0].limit_minutes, null);
  assert.equal(before.data.block_reason, "unavailable_days");
  assert.deepEqual(before.data.unavailable_dates, [monday]);
  const rejected = await confirm(proposal.data);
  assert.equal(rejected.statusCode, 422);
  assert.equal(rejected.code, "LIGHTTICK_UNAVAILABLE_PLANNING_DAY");
  const entry = await call("tasks/" + second.id + "/reschedule", "POST", { base_version: second.version, target_date: monday });
  assert.equal(entry.code, "LIGHTTICK_UNAVAILABLE_PLANNING_DAY");
  const sameDate = await call("tasks/" + first.id + "/reschedule", "POST", { base_version: first.version, target_date: monday });
  assert.equal(sameDate.statusCode, 200, JSON.stringify(sameDate.body));
  const complete = await call("tasks/" + first.id + "/complete", "POST", { base_version: sameDate.data.version, actual_duration_minutes: 7 });
  assert.equal(complete.statusCode, 200, JSON.stringify(complete.body));

  const rest = (planned_rest: boolean, base_version: number) => call("planning-calendar/rest", "PUT", { date: monday, planned_rest, base_version });
  assert.equal((await rest(true, 0)).statusCode, 200);
  const overlap = await preview();
  assert.equal(overlap.data.block_reason, "planned_rest");
  assert.deepEqual(overlap.data.planned_rest_dates, [monday]);
  assert.deepEqual(overlap.data.unavailable_dates, [monday]);
  assert.equal((await confirm(proposal.data)).code, "LIGHTTICK_PLANNED_REST_CONFLICT");
  assert.equal((await repository.getPlan(owner, proposal.data.id))?.status, "proposed");

  assert.equal((await set([1, 2], 1)).statusCode, 200);
  assert.equal((await preview()).data.block_reason, "planned_rest");
  assert.equal((await rest(false, 1)).statusCode, 200);
  assert.equal((await preview()).data.block_reason, null);
  assert.equal((await confirm(proposal.data)).statusCode, 200);
  assert.equal((await repository.getTask(owner, first.id))?.actualMinutes, 7);
});

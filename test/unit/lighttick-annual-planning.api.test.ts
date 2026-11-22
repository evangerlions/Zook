import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningYearEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { StageDefinition } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-12-31T16:15:00Z");
const stage: StageDefinition = { id: "first", title: "Explain the result", outcome_criteria: "Give two concrete reasons",
  starts_on: "2027-01-01", ends_on: "2027-02-01" };
const outside = { ...stage, id: "outside", starts_on: "2026-11-01", ends_on: "2026-12-01" };
const crossing = { ...stage, id: "crossing", starts_on: "2026-12-25", ends_on: "2027-01-01" };
const undated = { ...stage, id: "later", starts_on: null, ends_on: null };

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "annual-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString(),
  });
  const { app, services: { lighttickRuntime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = lighttickRuntime.repository;
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  const plans = new LightTickPlanService(repository, () => now);
  const tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function request(path: string, options: {
    method?: HttpRequest["method"]; body?: HttpRequest["body"]; query?: HttpRequest["query"]; user?: string; key?: string;
    unauthenticated?: boolean;
  } = {}) {
    const response = await app.handle({
      path: "/api/v1/lighttick/" + path, method: options.method ?? "GET", body: options.body, query: options.query ?? {},
      headers: {
        ...(options.unauthenticated ? {} : { authorization: "Bearer " + tokenService.issueAccessToken(options.user ?? owner.userId, appId) }),
        "x-app-id": appId, "idempotency-key": options.key ?? "planning-year-test-" + (++sequence),
      },
    });
    return { ...response, envelope: response.body as { data: any; code: string } };
  }
  async function createGoal(title: string, target_date: string, user?: string) {
    const result = await request("goals", { method: "POST", body: { title, target_date }, user });
    assert.equal(result.statusCode, 201, JSON.stringify(result.body));
    return result.envelope.data.id as string;
  }
  async function writeRoadmap(id: string, stages: StageDefinition[]) {
    const result = await request("goals/" + id + "/roadmap", { method: "PATCH", body: { base_version: 0, stages } });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  }
  const readRoadmap = async (id: string) => (await request("goals/" + id + "/roadmap")).envelope.data;
  const confirm = (body: Record<string, unknown>, key?: string) => request("planning-year/confirm", { method: "POST", body, key });
  assert.equal((await request("profile", { method: "PATCH", body: { base_version: 0, timezone: "Asia/Shanghai" } })).statusCode, 200);
  return { request, createGoal, writeRoadmap, readRoadmap, confirm, repository, plans, tasks };
}

test("annual projection uses the account calendar, includes crossing and undated stages and counts confirmed actions once", async () => {
  const { request, createGoal, writeRoadmap, plans, tasks } = await fixture();
  const goalId = await createGoal("Practice presenting", "2027-12-01");
  await createGoal("Foreign goal", "2027-05-01", "user_bob");
  await writeRoadmap(goalId, [outside, crossing, stage, undated]);
  const proposed = await plans.createProposed(owner, {
    goalId, source: "ai", granularity: "week", periodStart: "2026-12-28", periodEnd: "2027-01-03",
    tasks: [
      { title: "Last day of the old year", estimatedMinutes: 10, scheduledFor: "2026-12-31" },
      { title: "First day of the account year", estimatedMinutes: 10, scheduledFor: "2026-12-31T16:05:00Z" },
      { title: "Keep for later", estimatedMinutes: 10 },
    ],
  });
  const confirmed = await plans.confirm(owner, proposed.id, proposed.version);
  const completed = confirmed.tasks[1]!;
  await tasks.command(owner, completed.id, completed.version, { action: "complete", actualMinutes: 12 });
  await plans.createProposed(owner, {
    goalId, source: "ai", granularity: "week", periodStart: "2027-01-01", periodEnd: "2027-01-07",
    tasks: [{ title: "A draft action", estimatedMinutes: 10, scheduledFor: "2027-01-02" }],
  });

  const selected = await request("planning-year");
  assert.equal(selected.statusCode, 200, JSON.stringify(selected.body));
  assert.equal(selected.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningYearEnvelopeSchema);
  assert.equal(validate(selected.body), true, JSON.stringify(validate.errors));
  const { year, business_date, timezone, goals, months } = selected.envelope.data;
  assert.deepEqual({ year, business_date, timezone }, { year: 2027, business_date: "2027-01-01", timezone: "Asia/Shanghai" });
  assert.deepEqual(goals, [{ goal_id: goalId, title: "Practice presenting", status: "active", deadline: "2027-12-01",
    roadmap_version: 1, stages: [crossing, stage, undated].map(value => ({ ...value, outcome: null })) }]);
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { month: "2027-01", scheduled_actions: 1, completed_actions: 1 });
  assert.ok(months.slice(1).every((month: { scheduled_actions: number }) => month.scheduled_actions === 0));
  const previous = await request("planning-year", { query: { year: "2026" } });
  assert.deepEqual(previous.envelope.data.goals[0].stages.map((value: StageDefinition) => value.id), ["outside", "crossing", "later"]);
  assert.deepEqual(previous.envelope.data.months[11], { month: "2026-12", scheduled_actions: 1, completed_actions: 0 });
  assert.equal((await request("planning-year", { query: { year: "2027-01" } })).statusCode, 400);
  assert.equal((await request("planning-year", { unauthenticated: true })).statusCode, 401);
  const wrongMethod = await request("planning-year", { method: "POST" });
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers?.Allow, "GET");
});

test("annual confirmation keeps deadlines and other years, rolls back all changes and replays the first receipt", async () => {
  const { createGoal, writeRoadmap, readRoadmap, confirm, repository } = await fixture();
  const first = await createGoal("Practice presenting", "2027-12-01");
  const second = await createGoal("Practice reading", "2027-04-01");
  await writeRoadmap(first, [outside, stage]);
  await writeRoadmap(second, [stage]);
  const before = await Promise.all([readRoadmap(first), readRoadmap(second)]);
  const firstChange = { goal_id: first, base_version: 1, stages: [outside, { ...stage, title: "Present with a recording" }] };
  const secondChange = { goal_id: second, base_version: 1, stages: [{ ...stage, title: "Read and explain a paragraph" }] };
  const stale = await confirm({ year: 2027, changes: [firstChange, { ...secondChange, base_version: 0 }] });
  assert.equal(stale.statusCode, 409, JSON.stringify(stale.body));
  assert.equal(stale.envelope.code, "LIGHTTICK_VERSION_CONFLICT");
  assert.deepEqual(await Promise.all([readRoadmap(first), readRoadmap(second)]), before);
  const outsideEdit = await confirm({ year: 2027, changes: [secondChange, { ...firstChange, stages: [stage] }] });
  assert.equal(outsideEdit.statusCode, 400, JSON.stringify(outsideEdit.body));
  assert.deepEqual(await Promise.all([readRoadmap(first), readRoadmap(second)]), before);

  const command = { year: 2027, changes: [firstChange, secondChange] };
  const saved = await confirm(command, "annual-confirm-replay");
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.headers?.["Cache-Control"], "no-store");
  assert.deepEqual(saved.envelope.data.goals.map((goal: { roadmap_version: number; deadline: string }) =>
    [goal.roadmap_version, goal.deadline]).sort(), [[2, "2027-04-01"], [2, "2027-12-01"]]);
  assert.deepEqual((await confirm(command, "annual-confirm-replay")).envelope.data, saved.envelope.data);
  assert.equal((await confirm({ year: 2026, changes: command.changes }, "annual-confirm-replay")).envelope.code,
    "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  assert.deepEqual((await readRoadmap(first)).stages[0], { ...outside, outcome: null });
  assert.equal((await readRoadmap(second)).version, 2);
  assert.equal((await repository.listTasks(owner)).length, 0);
  assert.equal((await repository.listPlans(owner)).length, 0);
});

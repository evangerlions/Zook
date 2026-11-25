import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickGoalRoadmapEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { planningConditionContext } from "../../src/modules/lighttick/goal-context/confirmed-conditions.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { GOAL_ROADMAP_KEY } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-11-29T12:00:00Z");
const firstStage = { id: "first", title: "Arrange one work report", outcome_criteria: "State one conclusion and two reasons",
  starts_on: "2026-11-29", ends_on: "2026-12-06" };
const nextStage = { id: "next", title: "Answer questions", outcome_criteria: "Record two concrete answers", starts_on: null, ends_on: null };

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validateRoadmap = ajv.compile(LightTickGoalRoadmapEnvelopeSchema);

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "roadmap-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN",
    joinedAt: "2026-11-01T00:00:00Z",
  });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime, tokenService } = application.services;
  const repository = lighttickRuntime.repository;
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  lighttickRuntime.plans = new LightTickPlanService(repository, () => now);
  let sequence = 0;
  async function request(path: string, options: {
    method?: HttpRequest["method"]; body?: HttpRequest["body"]; who?: string; key?: string; unauthenticated?: boolean;
  } = {}) {
    const response = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method: options.method ?? "GET", query: {}, body: options.body,
      headers: {
        ...(options.unauthenticated ? {} : { authorization: "Bearer " + tokenService.issueAccessToken(options.who ?? owner.userId, appId) }),
        "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": options.key ?? "roadmap-" + (++sequence),
      },
    });
    return { ...response, envelope: response.body as { code: string; data: any } };
  }
  async function createGoal() {
    const saved = await request("goals", { method: "POST", body: {
      title: "Improve reporting", target_date: "2026-12-20", constraints: { legacy: "keep" },
    } });
    assert.equal(saved.statusCode, 201);
    return saved.envelope.data;
  }
  return { request, createGoal, repository, plans: lighttickRuntime.plans };
}

test("roadmap writes are owner-scoped, versioned, idempotent and leave scheduling unchanged", async () => {
  const { request, createGoal, repository } = await fixture();
  const goal = await createGoal(), path = "goals/" + goal.id + "/roadmap";
  const empty = await request(path);
  assert.equal(empty.headers?.["Cache-Control"], "no-store");
  assert.deepEqual(empty.envelope.data, { goal_id: goal.id, version: 0, stages: [] });
  assert.equal((await request(path, { who: "user_bob" })).statusCode, 404);
  assert.equal((await request(path, { unauthenticated: true })).statusCode, 401);
  const original = { method: "PATCH" as const, key: "same-roadmap-command", body: { base_version: 0, stages: [firstStage, nextStage] } };
  const saved = await request(path, original);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(validateRoadmap(saved.body), true, JSON.stringify(validateRoadmap.errors));
  assert.deepEqual(saved.envelope.data, { goal_id: goal.id, version: 1,
    stages: [{ ...firstStage, outcome: null }, { ...nextStage, outcome: null }] });
  assert.deepEqual((await request(path, original)).envelope.data, saved.envelope.data);
  assert.equal((await request(path, { ...original, body: { base_version: 0, stages: [nextStage] } })).envelope.code,
    "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  assert.equal((await request(path, { ...original, key: "unconfirmed-roadmap" })).envelope.code, "LIGHTTICK_VERSION_CONFLICT");
  assert.equal((await request(path, { ...original, who: "user_bob" })).statusCode, 404);
  const reordered = await request(path, { method: "PATCH", body: { base_version: 1, stages: [nextStage, firstStage] } });
  assert.deepEqual(reordered.envelope.data.stages.map((stage: { id: string }) => stage.id), ["next", "first"]);
  assert.equal((await repository.listTasks(owner)).length, 0);
  assert.equal((await repository.listPlans(owner)).length, 0);
  const changes = await repository.pullChanges(owner, 0, 20);
  assert.equal(changes.at(-1)?.entityType, "goal");
  assert.equal((changes.at(-1)?.snapshot?.constraints as Record<string, any>)[GOAL_ROADMAP_KEY].version, 2);
});

test("stage outcomes require explicit transitions and retain plan and outcome evidence", async () => {
  const { request, createGoal, repository, plans } = await fixture();
  const goal = await createGoal(), path = "goals/" + goal.id + "/roadmap";
  const saved = await request(path, { method: "PATCH", body: { base_version: 0, stages: [firstStage, nextStage] } });
  assert.equal(saved.statusCode, 200);
  const plan = await plans.createProposed(owner, {
    goalId: goal.id, granularity: "week", source: "ai", periodStart: "2026-11-29", periodEnd: "2026-12-02",
    tasks: [{ title: "Record one practice report", estimatedMinutes: 10, scheduledFor: "2026-11-29" }],
    metadata: { stage_id: firstStage.id },
  });
  const accepted = await plans.confirm(owner, plan.id, plan.version);
  assert.equal((await request("goals/" + goal.id + "/result", { method: "PUT", body: {
    mode: "milestones", milestones: [{ id: "legacy-milestone", title: "An old milestone", completed: false }],
  } })).statusCode, 200);
  const notePath = path + "/stages/first/outcome";
  const complete = await request("tasks/" + accepted.tasks[0]!.id + "/complete", { method: "POST",
    body: { base_version: accepted.tasks[0]!.version, actual_duration_minutes: 9 } });
  assert.equal(complete.statusCode, 200);
  const afterTask = await request(path);
  assert.equal(afterTask.envelope.data.version, 1);
  assert.equal(afterTask.envelope.data.stages[0].outcome, null);
  assert.deepEqual(afterTask.envelope.data.stages[0].plans, [{
    id: plan.id, title: "计划 2026-11-29", status: "active", period_start: "2026-11-29", period_end: "2026-12-02", source: "ai",
  }]);
  const beforeTasks = await repository.listTasks(owner);
  assert.equal((await request(notePath, { method: "POST", body: { base_version: 1, state: "reopened", note: "Premature" } })).statusCode, 409);
  assert.equal((await request(path, { method: "PATCH", body: { base_version: 1, stages: [nextStage] } })).statusCode, 409);
  const command = { method: "POST" as const, key: "close-roadmap-stage", body: {
    base_version: 1, state: "achieved", note: "I can explain the result using the two references.",
  } };
  const confirmed = await request(notePath, command);
  assert.equal(confirmed.statusCode, 200);
  assert.deepEqual(confirmed.envelope.data.stages[0].outcome, {
    state: "achieved", note: command.body.note, recorded_at: now.toISOString(),
  });
  assert.deepEqual((await request(notePath, command)).envelope.data, confirmed.envelope.data);
  assert.equal((await request(path, { method: "PATCH", body: { base_version: 2, stages: [
    { ...firstStage, outcome_criteria: "Replace confirmed success criteria" }, nextStage,
  ] } })).statusCode, 409);
  const reopened = await request(notePath, { method: "POST", body: { base_version: 2, state: "reopened", note: "Try again under a time limit." } });
  assert.equal(reopened.statusCode, 200);
  assert.equal(validateRoadmap(reopened.body), true, JSON.stringify(validateRoadmap.errors));
  assert.equal(reopened.envelope.data.stages[0].outcome.state, "reopened");
  assert.deepEqual(reopened.envelope.data.stages[0].outcome_history, [confirmed.envelope.data.stages[0].outcome]);
  const adjusted = { ...firstStage, outcome_criteria: "Explain the result in 60 seconds" };
  assert.equal((await request(path, { method: "PATCH", body: { base_version: 3, stages: [adjusted, nextStage] } })).statusCode, 200);
  assert.deepEqual(await repository.listTasks(owner), beforeTasks);
  assert.equal((await repository.getGoal(owner, goal.id))?.targetDate, "2026-12-20");
  const workspace = await request("goals/workspace");
  assert.equal(workspace.envelope.data.goals[0].result.milestones[0].id, "legacy-milestone");
  const facts = (await repository.listExecutionEvents(owner)).filter(event => event.eventType === "goal_roadmap_stage_outcome_recorded");
  assert.deepEqual(facts.map(fact => fact.payload.state).sort(), ["achieved", "reopened"]);
  assert.equal(facts.find(fact => fact.payload.state === "achieved")?.payload.outcome_criteria, firstStage.outcome_criteria);
});

test("roadmaps reject invalid definitions, raw goal injection and offline mutations", async () => {
  const { request, createGoal, repository } = await fixture();
  const forged = { schema_version: 1, version: 9, stages: [{ ...firstStage, outcome: null }] };
  const forbiddenCreate = await request("goals", { method: "POST", body: { title: "Raw create", constraints: { [GOAL_ROADMAP_KEY]: forged } } });
  assert.equal(forbiddenCreate.statusCode, 422);
  const goal = await createGoal(), base = "goals/" + goal.id, path = base + "/roadmap";
  const badStages = [
    [firstStage, firstStage],
    [{ ...firstStage, starts_on: null }],
    [{ ...firstStage, starts_on: "2026-11-31" }],
    [{ ...firstStage, ends_on: "2026-11-26" }],
    [{ ...firstStage, ends_on: "2026-12-21" }],
    [{ ...firstStage, outcome_criteria: "  " }],
    [{ ...firstStage, outcome: { state: "achieved", note: "Synthetic", recorded_at: now.toISOString() } }],
  ];
  for (const stages of badStages) assert.equal((await request(path, { method: "PATCH", body: { base_version: 0, stages } })).statusCode, 400);
  assert.equal((await request(path, { method: "PATCH", body: { base_version: 0, stages: [firstStage] } })).statusCode, 200);
  const current = await request(base);
  const badPatch = await request(base, { method: "PATCH", body: {
    base_version: current.envelope.data.version, constraints: { [GOAL_ROADMAP_KEY]: forged },
  } });
  assert.equal(badPatch.statusCode, 422);
  const legacyPatch = await request(base, { method: "PATCH", body: {
    base_version: current.envelope.data.version, constraints: { legacy: "updated" },
  } });
  assert.equal(legacyPatch.statusCode, 200);
  const stageResult = await request(path + "/stages/first/outcome", { method: "POST", body: {
    base_version: 1, state: "achieved", note: "Keep private from implicit model inputs.",
  } });
  assert.equal(stageResult.statusCode, 200);
  const stored = await repository.getGoal(owner, goal.id);
  assert(stored);
  assert.equal(stored.constraints.legacy, "updated");
  assert.equal(Object.hasOwn(planningConditionContext(stored, {}, "UTC", now), GOAL_ROADMAP_KEY), false);
  const sync = await request("sync/push", { method: "POST", body: { operations: [{
    operation_id: "offline-roadmap-forgery", device_id: "a-device", entity_type: "goal", entity_id: goal.id,
    action: "update", base_version: stored.version, client_occurred_at: now.toISOString(), payload: { constraints: { [GOAL_ROADMAP_KEY]: forged } },
  }] } });
  assert.equal(sync.envelope.data.results[0].status, "rejected");
  assert.deepEqual((await request(path)).envelope.data, stageResult.envelope.data);
  const archived = await request(base + "/lifecycle", { method: "POST", body: { base_version: stored.version, action: "archive" } });
  assert.equal(archived.statusCode, 200);
  assert.deepEqual((await request(path)).envelope.data, stageResult.envelope.data);
  assert.equal((await request(path, { method: "PATCH", body: { base_version: 2, stages: [firstStage] } })).envelope.code,
    "LIGHTTICK_STATE_TRANSITION_INVALID");
});

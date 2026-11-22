import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickPlanningYearDraftEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { LightTickScopePolicy } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import type { AnnualDraftSuggestion } from "../../src/modules/lighttick/planning/annual-draft-generation.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const now = new Date("2026-11-30T16:10:00Z");
const editable = { id: "stage-next", title: "Try a structured report", outcome_criteria: "Summarize a decision",
  starts_on: null, ends_on: null };
const historical = { id: "stage-history", title: "Initial practice", outcome_criteria: "Save a first draft",
  starts_on: "2025-03-01", ends_on: "2025-03-30" };
const withPlan = { id: "stage-linked", title: "Review a report with a colleague", outcome_criteria: "Use one example",
  starts_on: "2026-12-01", ends_on: "2026-12-07" };
const newStage = { id: null, title: "Check reading comprehension", outcome_criteria: "Summarize a passage independently",
  starts_on: "2026-12-07", ends_on: "2026-12-15" };

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "annual-draft-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString(),
  });
  const record = seed.appConfigs.find(value => value.appId === appId && value.configKey === "admin.delivery_config")!;
  const config = JSON.parse(record.configValue);
  record.configValue = JSON.stringify({ ...config, enabled: true, settings: { ...config.settings, runtimeScope: "full" },
    featureFlags: { ...config.featureFlags, aiPlanning: true, conversationalPlanning: true } });
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime: runtime, tokenService } = application.services;
  runtime.planningEnabled = true;
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  const roadmaps = new GoalRoadmapService(repository, () => now);
  const plans = new LightTickPlanService(repository, () => now);
  let seq = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"], options: {
    key?: string; user?: string; unauthenticated?: boolean;
  } = {}) {
    const result = await application.app.handle({ path: "/api/v1/lighttick/" + path, method, body, headers: {
      ...(options.unauthenticated ? {} : { authorization: "Bearer " + tokenService.issueAccessToken(options.user ?? owner.userId, appId) }),
      "x-app-id": appId, "idempotency-key": options.key ?? "annual-draft-" + (++seq),
    } });
    return { ...result, value: result.body as { code: string; data: any } };
  }
  async function execute(model: (request: LLMCompletionRequest) => AnnualDraftSuggestion | Promise<AnnualDraftSuggestion>,
    enabled: () => boolean = () => runtime.planningEnabled) {
    const runner = new LightTickAiRunner(repository, { complete: async request =>
      ({ provider: "fake", providerModel: "fake", modelKey: request.modelKey ?? "fake", text: JSON.stringify(await model(request)) }) },
    () => now, undefined, undefined, async () => enabled());
    runtime.worker = new LightTickWorker(runner);
    await application.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
  }
  function createGoal(title: string, targetDate?: string, userId: string = owner.userId) {
    return runtime.goals.create({ appId, userId }, { title, targetDate, constraints: { private: "PRIVATE_RAW_GOAL_CONSTRAINT" } });
  }
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" })).statusCode, 200);
  return { call, createGoal, repository, runtime, roadmaps, plans, execute };
}

function proposal(first: string, second: string): AnnualDraftSuggestion {
  return { summary: "Reserve time for regular practice.",
    changes: [{
      goal_id: first, stages: [{ id: editable.id, title: "Practice a 90-second report", outcome_criteria: "Record a conclusion and two facts",
        starts_on: "2026-12-08", ends_on: "2026-12-12" }],
    }, { goal_id: second, stages: [newStage] }],
    month_focus: [{ month: "2026-12", goal_ids: [first, second], summary: "Check the current baseline on both goals." }],
    weekly_allocations: [{ goal_id: second, minutes: 20 }, { goal_id: first, minutes: 60 }],
  };
}

test("annual suggestions use selected goals and authoritative budget, preserve stage scope and require explicit confirmation", async () => {
  const { call, createGoal, repository, roadmaps, plans, execute } = await fixture();
  const reporting = await createGoal("Practice reporting", "2026-12-12");
  const reading = await createGoal("Read a short passage", "2026-12-20");
  await createGoal("PRIVATE_UNSELECTED_GOAL");
  await roadmaps.update(owner, reporting.id, { base_version: 0, stages: [historical, withPlan, editable] });
  const work = await plans.createProposed(owner, {
    goalId: reporting.id, source: "ai", granularity: "week", periodStart: "2026-12-01", periodEnd: "2026-12-07",
    tasks: [{ title: "PRIVATE_EXISTING_TASK", scheduledFor: "2026-12-02", estimatedMinutes: 20 }],
    metadata: { stage_id: withPlan.id },
  });
  await plans.confirm(owner, work.id, work.version);
  assert.equal((await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 100, plan_percent: 80 })).statusCode, 200);
  const before = await repository.listTasks(owner);
  const input = { year: 2026, goal_ids: [reporting.id, reading.id], focus: "Practice reporting first." };
  const queued = await call("planning-year/draft", "POST", input, { key: "annual-draft-replay" });
  assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
  assert.equal(queued.headers?.["Cache-Control"], "no-store");
  const path = "planning-year/draft/" + queued.value.data.id;
  assert.equal(queued.value.data.status, "queued");
  assert.equal((await call(path, "GET", undefined, { user: "user_bob" })).statusCode, 404);
  assert.equal((await call("planning-year/draft", "POST", { ...input, focus: "Different" }, { key: "annual-draft-replay" })).statusCode, 409);
  assert.deepEqual((await call("planning-year/draft", "POST", input, { key: "annual-draft-replay" })).value.data, queued.value.data);

  let invocations = 0;
  await execute(request => {
    invocations++;
    const message = request.messages.at(-1)?.content;
    assert.equal(typeof message, "string");
    if (typeof message !== "string") throw new Error("Expected the annual prompt");
    assert.match(message, /"starts_on":"2026-12-01"/u);
    assert.match(message, /"weekly_budget_minutes":80/u);
    assert.match(message, /Practice reporting first/u);
    assert.doesNotMatch(message, /PRIVATE_|Initial practice|fingerprint/u);
    assert.ok(message.indexOf(reporting.id) < message.indexOf(reading.id));
    assert.equal(request.providerOptions?.zookLogBodyMode, "suppress");
    return proposal(reporting.id, reading.id);
  });
  assert.equal(invocations, 1);
  const loaded = await call(path);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningYearDraftEnvelopeSchema);
  assert.equal(validate(loaded.body), true, JSON.stringify(validate.errors));
  assert.equal(loaded.value.data.status, "succeeded", JSON.stringify(loaded.body));
  const output = loaded.value.data.output;
  assert.equal(output.weekly_budget_minutes, 80);
  assert.equal(output.weekly_tradeoff, undefined);
  assert.deepEqual(output.weekly_allocations, [{ goal_id: reporting.id, minutes: 60 }, { goal_id: reading.id, minutes: 20 }]);
  assert.deepEqual(output.changes[0].stages.slice(0, 2), [historical, withPlan]);
  assert.equal(output.changes[0].base_version, 1);
  assert.equal(output.changes[1].base_version, 0);
  assert.equal(output.changes[1].stages[0].id.startsWith("annual_stage"), true);
  assert.equal((await roadmaps.get(owner, reporting.id)).version, 1);
  assert.equal((await roadmaps.get(owner, reading.id)).version, 0);
  assert.deepEqual(await repository.listTasks(owner), before);

  const applied = await call("planning-year/confirm", "POST", { year: 2026, changes: [output.changes[0]] });
  assert.equal(applied.statusCode, 200, JSON.stringify(applied.body));
  assert.equal((await roadmaps.get(owner, reporting.id)).version, 2);
  assert.equal((await roadmaps.get(owner, reading.id)).version, 0);
  assert.equal((await repository.getGoal(owner, reporting.id))?.targetDate, "2026-12-12");
  assert.equal((await repository.listPlans(owner)).length, 1);
  assert.deepEqual(await repository.listTasks(owner), before);
});

test("annual suggestion request rejects unavailable, invalid, inaccessible and ended goals before dispatch", async () => {
  const { call, createGoal, runtime } = await fixture();
  const selected = await createGoal("Own goal");
  const foreign = await createGoal("Foreign goal", undefined, "user_bob");
  const overdue = await createGoal("Old goal", "2026-11-30");
  const archived = await createGoal("Archived goal");
  await runtime.goals.transition(owner, archived.id, archived.version, "archive");
  const draft = (year: number, ...goal_ids: string[]) => call("planning-year/draft", "POST", { year, goal_ids });
  runtime.planningEnabled = false;
  assert.equal((await draft(2026, selected.id)).statusCode, 503);
  runtime.planningEnabled = true;
  const scope = runtime.scopePolicy;
  const configRow = (await scope.record())!;
  for (const disabledFlag of ["aiPlanning", "conversationalPlanning"]) {
    const raw = JSON.parse(configRow.configValue);
    runtime.scopePolicy = new LightTickScopePolicy(async () => ({ ...configRow,
      configValue: JSON.stringify({ ...raw, featureFlags: { ...raw.featureFlags, [disabledFlag]: false } }) }));
    assert.equal((await draft(2026, selected.id)).statusCode, 503);
  }
  runtime.scopePolicy = scope;
  assert.equal((await call("planning-year/draft", "POST", { year: 2026, goal_ids: [selected.id] }, { unauthenticated: true })).statusCode, 401);
  assert.equal((await draft(2026, selected.id, selected.id)).statusCode, 400);
  assert.equal((await call("planning-year/draft", "POST", { year: 2026, goal_ids: [selected.id], focus: "x".repeat(501) })).statusCode, 400);
  assert.equal((await draft(2026, foreign.id)).statusCode, 404);
  assert.equal((await draft(2026, archived.id)).statusCode, 409);
  assert.equal((await draft(2026, overdue.id)).statusCode, 422);
  assert.equal((await draft(2025, selected.id)).statusCode, 422);
});

test("annual suggestions reject model violations and a stale budget or disabled generation during dispatch", async () => {
  const { call, createGoal, repository, runtime, roadmaps, execute } = await fixture();
  const reporting = await createGoal("Practice reporting", "2026-12-12");
  const second = await createGoal("Read a passage");
  const protectedStage = { ...editable, starts_on: "2026-12-01", ends_on: "2026-12-07" };
  await roadmaps.update(owner, reporting.id, { base_version: 0, stages: [protectedStage] });
  await roadmaps.recordOutcome(owner, reporting.id, protectedStage.id, { base_version: 1, state: "achieved", note: "Recorded real evidence" });
  const intent = { year: 2026, goal_ids: [reporting.id, second.id] };
  const start = async () => {
    const queued = await call("planning-year/draft", "POST", intent);
    assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
    return "planning-year/draft/" + queued.value.data.id;
  };
  const valid: AnnualDraftSuggestion = { summary: "Keep the current direction.",
    changes: [], month_focus: [], weekly_allocations: intent.goal_ids.map(goal_id => ({ goal_id, minutes: null })) };
  const okPath = await start();
  await execute(() => ({ ...valid, weekly_requested_minutes: intent.goal_ids.map(goal_id => ({ goal_id, minutes: 20 })) }));
  const withoutBudget = (await call(okPath)).value.data.output;
  assert.equal(withoutBudget.weekly_budget_minutes, null);
  assert.equal(withoutBudget.weekly_tradeoff, undefined);
  assert.deepEqual(withoutBudget.weekly_allocations, valid.weekly_allocations);

  for (const output of [
    { ...valid, changes: [{ goal_id: second.id, stages: [{ ...newStage, id: "invented" }] }] },
    { ...valid, changes: [{ goal_id: second.id, stages: [{ ...newStage, starts_on: "2026-11-30" }] }] },
    { ...valid, changes: [{ goal_id: reporting.id, stages: [newStage] }] },
    { ...valid, changes: [{ goal_id: reporting.id, stages: [{ ...newStage, id: protectedStage.id, ends_on: "2026-12-10" }] }] },
    { ...valid, changes: [{ goal_id: "foreign-goal", stages: [newStage] }] },
    { ...valid, weekly_allocations: [{ goal_id: reporting.id, minutes: 1 }, { goal_id: second.id, minutes: null }] },
    { ...valid, tasks: [{ title: "Model attempted to create a task" }] },
  ]) {
    const path = await start();
    await execute(() => output);
    const failed = (await call(path)).value.data;
    assert.equal(failed.status, "failed");
    assert.equal(failed.error_code, "LIGHTTICK_AI_RUN_FAILED");
    assert.equal(failed.output, undefined);
  }
  const stale = await start();
  await execute(async () => {
    assert.equal((await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 30, plan_percent: 100 })).statusCode, 200);
    return valid;
  });
  assert.equal((await call(stale)).value.data.error_code, "LIGHTTICK_PLANNING_STALE");
  const switchedOff = await start();
  await execute(() => {
    runtime.planningEnabled = false;
    return valid;
  });
  assert.equal((await call(switchedOff)).value.data.error_code, "LIGHTTICK_AI_UNAVAILABLE");
  assert.equal((await roadmaps.get(owner, reporting.id)).version, 2);
  assert.equal((await repository.listPlans(owner)).length, 0);
  assert.equal((await repository.listTasks(owner)).length, 0);
});

test("annual time tradeoffs separate over-budget scope decisions from a feasible reduced draft", async () => {
  const { call, createGoal, repository, roadmaps, execute } = await fixture();
  const first = await createGoal("Practice reporting", "2026-12-12");
  const second = await createGoal("Read a passage", "2026-12-22");
  await roadmaps.update(owner, first.id, { base_version: 0, stages: [editable, withPlan] });
  await roadmaps.recordOutcome(owner, first.id, withPlan.id, { base_version: 1, state: "achieved", note: "Recorded real evidence" });
  const budget = await call("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 100, plan_percent: 80 });
  assert.equal(budget.statusCode, 200, JSON.stringify(budget.body));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickPlanningYearDraftEnvelopeSchema);
  const selected = [first.id, second.id];
  async function result(raw: AnnualDraftSuggestion) {
    const queued = await call("planning-year/draft", "POST", { year: 2026, goal_ids: selected });
    assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
    await execute(() => raw);
    const stored = await call("planning-year/draft/" + queued.value.data.id);
    assert.equal(stored.statusCode, 200);
    assert.equal(validate(stored.body), true, JSON.stringify(validate.errors));
    return stored.value.data;
  }
  const feasible = proposal(first.id, second.id);
  const overBudget = { ...feasible, weekly_allocations: [{ goal_id: second.id, minutes: 50 }, { goal_id: first.id, minutes: 60 }] };
  const decision = await result(overBudget);
  assert.equal(decision.status, "succeeded", JSON.stringify(decision));
  assert.equal(decision.output.weekly_budget_minutes, 80);
  assert.deepEqual(decision.output.weekly_tradeoff, {
    kind: "decision_needed", requested_minutes: 110, available_minutes: 80, shortfall_minutes: 30,
    goals: [{ goal_id: first.id, requested_minutes: 60, proposed_minutes: null },
      { goal_id: second.id, requested_minutes: 50, proposed_minutes: null }],
  });
  assert.deepEqual(decision.output.changes, []);
  assert.deepEqual(decision.output.month_focus, []);
  assert.deepEqual(decision.output.weekly_allocations, []);
  assert.notEqual(decision.output.summary, overBudget.summary);

  const fullEstimate = [{ goal_id: second.id, minutes: 50 }, { goal_id: first.id, minutes: 90 }];
  const reduced = await result({ ...feasible, weekly_requested_minutes: fullEstimate });
  assert.equal(reduced.status, "succeeded", JSON.stringify(reduced));
  assert.deepEqual(reduced.output.weekly_tradeoff, {
    kind: "reduced_scope", requested_minutes: 140, available_minutes: 80, shortfall_minutes: 60,
    goals: [{ goal_id: first.id, requested_minutes: 90, proposed_minutes: 60 },
      { goal_id: second.id, requested_minutes: 50, proposed_minutes: 20 }],
  });
  assert.deepEqual(reduced.output.weekly_allocations, [{ goal_id: first.id, minutes: 60 }, { goal_id: second.id, minutes: 20 }]);
  assert.equal(reduced.output.changes.length, 2);
  assert.equal(reduced.output.changes[0].base_version, 2);
  assert.equal(reduced.output.changes[0].stages[1].title, withPlan.title);
  assert.deepEqual(reduced.output.month_focus, feasible.month_focus);

  const decisionWithEstimate = await result({ ...overBudget, weekly_requested_minutes: fullEstimate });
  assert.equal(decisionWithEstimate.output.weekly_tradeoff.kind, "decision_needed");
  assert.equal(decisionWithEstimate.output.weekly_tradeoff.requested_minutes, 140);
  assert.equal(decisionWithEstimate.output.weekly_tradeoff.shortfall_minutes, 60);

  for (const invalidOutput of [
    { ...overBudget, changes: [{ goal_id: first.id, stages: [{ ...newStage, id: withPlan.id, ends_on: "2026-12-10" }] }] },
    { ...overBudget, changes: [{ goal_id: first.id, stages: [newStage] }] },
    { ...overBudget, tasks: [{ title: "Model cannot create tasks" }] },
    { ...overBudget, weekly_requested_minutes: [{ goal_id: "foreign-goal", minutes: 60 }, fullEstimate[0]!] },
    { ...overBudget, weekly_requested_minutes: [fullEstimate[0]!, fullEstimate[0]!] },
    { ...overBudget, weekly_requested_minutes: [{ goal_id: first.id, minutes: 60.5 }, fullEstimate[0]!] },
    { ...overBudget, weekly_requested_minutes: [{ goal_id: first.id, minutes: 59 }, fullEstimate[0]!] },
  ]) {
    const failed = await result(invalidOutput);
    assert.equal(failed.status, "failed");
    assert.equal(failed.error_code, "LIGHTTICK_AI_RUN_FAILED");
    assert.equal(failed.output, undefined);
  }
  assert.equal((await roadmaps.get(owner, first.id)).version, 2);
  assert.equal((await roadmaps.get(owner, second.id)).version, 0);
  assert.equal((await repository.listPlans(owner)).length, 0);
  assert.equal((await repository.listTasks(owner)).length, 0);
});

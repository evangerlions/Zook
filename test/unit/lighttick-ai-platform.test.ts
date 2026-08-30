import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { LIGHTTICK_AI_SCENES } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { assembleLightTickContext } from "../../src/modules/lighttick/ai/lighttick-ai-context.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { validatePlanOutput, validateReviewOutput } from "../../src/modules/lighttick/ai/lighttick-ai-validation.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickReviewService } from "../../src/modules/lighttick/lighttick-review.service.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "user_ai" };
const now = "2026-08-20T00:00:00.000Z";
let sequence = 0;
async function queued(repository: InMemoryLightTickRepository, inputContext: Record<string, unknown>, kind = "plan", resourceId?: string) {
  const row: LightTickAiRunRow = { ...owner, id: `lighttick_run_test_${++sequence}`, kind, status: "queued", sceneKey: "test",
    resourceId, promptVersion: "1", schemaVersion: "1", attemptCount: 0, inputContext, usage: {}, createdAt: now, updatedAt: now };
  return await repository.saveAiRun(row);
}
function fakeComplete(result: string | Error) {
  return { complete: async () => { if (result instanceof Error) throw result; return { provider: "fake", modelKey: "fake",
    providerModel: "fake-v1", text: result, usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } }; } };
}

test("AI runner requests compact JSON mode with the scene schema", async () => {
  const repository = new InMemoryLightTickRepository();
  const run = await queued(repository, { period_start: "2026-08-17", period_end: "2026-08-23", available_minutes: 120 });
  let captured: any;
  const llm = { complete: async (request: any) => {
    captured = request;
    return { provider: "fake", modelKey: "fake", providerModel: "fake-v1",
      text: JSON.stringify({ tasks: [{ title: "Build", estimated_minutes: 60 }] }) };
  } };
  await new LightTickAiRunner(repository, llm as any, () => new Date(now)).execute(owner, run.id, "week_plan");
  assert.deepEqual(captured.providerOptions, { response_format: { type: "json_object" }, enable_thinking: false });
  assert.match(captured.messages[1].content, /OUTPUT_JSON_SCHEMA=/);
  assert.match(captured.messages[1].content, /at most 120/);
  assert.match(captured.messages[1].content, /2026-08-17 through 2026-08-23/);
  assert.match(captured.messages[1].content, /Do not use Markdown fences/);
});

test("onboarding plan prompt prohibits invented dates when no period was requested", async () => {
  const repository = new InMemoryLightTickRepository();
  const run = await queued(repository, { weekly_available_minutes: 120 }, "onboarding_plan");
  let prompt = "";
  const llm = { complete: async (request: any) => {
    prompt = request.messages[1].content;
    return { provider: "fake", modelKey: "fake", providerModel: "fake-v1",
      text: JSON.stringify({ tasks: [{ title: "Build", estimated_minutes: 60 }] }) };
  } };
  await new LightTickAiRunner(repository, llm as any, () => new Date(now)).execute(owner, run.id, "onboarding_plan");
  assert.match(prompt, /at most 120/);
  assert.match(prompt, /Omit scheduled_for from every task/);
});

test("scene registry defines bounded routes, budgets, versions, and fallback policies", () => {
  assert.equal(Object.keys(LIGHTTICK_AI_SCENES).length, 8);
  for (const scene of Object.values(LIGHTTICK_AI_SCENES)) {
    assert.match(scene.key, /^lighttick\./); assert.ok(scene.timeoutMs <= 30_000);
    assert.ok(scene.maxContextTokens <= 10_000); assert.ok(scene.maxOutputTokens <= 4_000);
    assert.match(scene.promptVersion, /^\d+\.\d+\.\d+$/); assert.match(scene.schemaVersion, /^\d+\.\d+\.\d+$/);
  }
});

test("AI runner records schema-valid output, route usage, and latency", async () => {
  const repository = new InMemoryLightTickRepository();
  const run = await queued(repository, { period_start: "2026-08-17", period_end: "2026-08-23", available_minutes: 120 });
  const runner = new LightTickAiRunner(repository, fakeComplete(JSON.stringify({ tasks: [
    { title: "Build", estimated_minutes: 60, priority: 10 } ] })) as any, () => new Date(now));
  const completed = await runner.execute(owner, run.id, "week_plan");
  assert.equal(completed.status, "succeeded"); assert.equal(completed.provider, "fake");
  assert.equal(completed.usage.totalTokens, 20); assert.equal((completed.output as any).tasks.length, 1);
});

test("successful plan run materializes exactly one confirmable proposed plan", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, () => new Date(now)).create(owner, { title: "Launch", constraints: {} });
  const request = { goal_id: goal.id, period_start: "2026-08-17", period_end: "2026-08-23", available_minutes: 120 };
  const run = await queued(repository, request, "plan", goal.id);
  const runner = new LightTickAiRunner(repository, fakeComplete(JSON.stringify({ tasks: [
    { title: "Build", estimated_minutes: 60, priority: 10 } ] })) as any, () => new Date(now));

  const completed = await runner.execute(owner, run.id, "week_plan");
  const plans = await repository.listPlans(owner, goal.id);
  assert.equal(plans.length, 1); assert.equal(plans[0]?.status, "proposed");
  assert.equal(completed.resourceId, plans[0]?.id);
  assert.equal((plans[0]?.proposal as any).ai_run_id, run.id);
  assert.equal((await runner.execute(owner, run.id, "week_plan")).resourceId, plans[0]?.id);
  assert.equal((await repository.listPlans(owner, goal.id)).length, 1);
});

test("review and change-proposal runs materialize client-readable resources", async () => {
  const repository = new InMemoryLightTickRepository(); const clock = () => new Date(now);
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "Launch", constraints: {} });
  const review = await new LightTickReviewService(repository, clock).create(owner, goal.id, "week", "2026-08-17", "2026-08-23");
  const reviewRun = await queued(repository, { goal_id: goal.id }, "review", review.id);
  const reviewResult = await new LightTickAiRunner(repository, fakeComplete(JSON.stringify({
    insights: ["完成率稳定"], recommendations: ["保持节奏"],
  })) as any, clock).execute(owner, reviewRun.id, "weekly_review");
  assert.equal(reviewResult.resourceId, review.id);
  assert.deepEqual((await repository.listReviews(owner))[0]?.output.insights, ["完成率稳定"]);

  const plans = new LightTickPlanService(repository, clock);
  const proposed = await plans.createProposed(owner, { goalId: goal.id, granularity: "week", periodStart: "2026-08-17",
    periodEnd: "2026-08-23", source: "template", tasks: [{ title: "Build", estimatedMinutes: 60 }] });
  const active = await plans.confirm(owner, proposed.id, 1); const task = active.tasks[0]!;
  const proposalRun = await queued(repository, { plan_id: active.plan.id, base_version: active.plan.version,
    reason: "low_energy" }, "change_proposal", active.plan.id);
  const proposalResult = await new LightTickAiRunner(repository, fakeComplete(JSON.stringify({
    diff: [{ action: "update_task", task_id: task.id, estimated_minutes: 30 }],
    impact: { total_minutes_delta: -30, task_count_delta: 0, commitment_boundary_changed: false },
  })) as any, clock).execute(owner, proposalRun.id, "change_proposal");
  const materialized = (await repository.listProposals(owner, active.plan.id))[0]!;
  assert.equal(proposalResult.resourceId, materialized.id); assert.equal(materialized.status, "pending");
  assert.equal(materialized.impact.ai_run_id, proposalRun.id);
});

test("malformed/schema-invalid/provider-outage plans fall back deterministically", async () => {
  for (const failure of ["not-json", JSON.stringify({ tasks: [{ title: "Too much", estimated_minutes: 500 }] }),
    new ApplicationError(503, "LIGHTTICK_AI_UNAVAILABLE", "offline"), new ApplicationError(429, "LIGHTTICK_AI_QUOTA_EXCEEDED", "quota")]) {
    const repository = new InMemoryLightTickRepository();
    const run = await queued(repository, { period_start: "2026-08-20", period_end: "2026-08-20", available_minutes: 30 });
    const completed = await new LightTickAiRunner(repository, fakeComplete(failure) as any, () => new Date(now))
      .execute(owner, run.id, "day_plan");
    assert.equal(completed.status, "succeeded"); assert.equal(completed.provider, "deterministic_template");
    assert.equal((completed.output as any).tasks[0].estimated_minutes, 30);
  }
});

test("coach outage returns a facts-only fallback without changing plans", async () => {
  const repository = new InMemoryLightTickRepository(); const goal = await new LightTickGoalService(repository, () => new Date(now))
    .create(owner, { title: "Launch", constraints: {} });
  const run = await queued(repository, { goal_id: goal.id, coach_scene: "recovery" }, "coach_reply");
  const completed = await new LightTickAiRunner(repository, fakeComplete(new Error("offline")) as any, () => new Date(now))
    .execute(owner, run.id, "coach_reply");
  assert.equal(completed.status, "succeeded"); assert.equal(completed.provider, "deterministic_template");
  assert.equal((completed.output as any).source, "facts_only"); assert.equal((await repository.listPlans(owner, goal.id)).length, 0);
});

test("unsafe proposal output fails without mutating plan and minimal context redacts notes", async () => {
  const repository = new InMemoryLightTickRepository(); const goals = new LightTickGoalService(repository, () => new Date(now));
  const goal = await goals.create(owner, { title: "Safe", constraints: { weekly_available_minutes: 60 } });
  const plans = new LightTickPlanService(repository, () => new Date(now));
  const plan = await plans.createProposed(owner, { goalId: goal.id, granularity: "week", periodStart: "2026-08-17",
    periodEnd: "2026-08-23", source: "manual", tasks: [{ title: "Private", estimatedMinutes: 30 }] });
  const materialized = await plans.confirm(owner, plan.id, 1); const task = materialized.tasks[0]!;
  const context = await assembleLightTickContext(repository, owner, { plan_id: plan.id });
  assert.equal(JSON.stringify(context).includes("notes"), false);
  const run = await queued(repository, { plan_id: plan.id }, "change_proposal");
  const output = JSON.stringify({ diff: [{ action: "delete_database", task_id: task.id }], impact: {} });
  const completed = await new LightTickAiRunner(repository, fakeComplete(output) as any, () => new Date(now))
    .execute(owner, run.id, "change_proposal");
  assert.equal(completed.status, "failed"); assert.equal(completed.errorCode, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  assert.equal((await repository.getPlan(owner, plan.id))?.status, "active");
});

test("privacy-safe golden fixtures pass deterministic schema and constraint evaluation", async () => {
  const fixture = JSON.parse(await readFile(new URL("../../api-contracts/fixtures/lighttick-ai-golden.json", import.meta.url), "utf8"));
  const report = fixture.cases.map((item: any) => {
    if (item.scene === "week_plan") validatePlanOutput(item.output, { availableMinutes: item.input.available_minutes,
      periodStart: item.input.period_start, periodEnd: item.input.period_end }); else validateReviewOutput(item.output);
    return { scene: item.scene, parse: true, constraints: true };
  });
  assert.deepEqual(report, [{ scene: "week_plan", parse: true, constraints: true },
    { scene: "weekly_review", parse: true, constraints: true }]);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { createLightTickAiRun } from "../../src/modules/lighttick/ai/lighttick-ai-run-record.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { LightTickReflectionService } from "../../src/modules/lighttick/lighttick-reflection.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { assertNextWeekContextCurrent, loadNextWeekContext, nextWeekRange,
  type NextWeekContext, validateNextWeekAdvice } from "../../src/modules/lighttick/next-week-advice.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "advice-owner" } as const;
const now = new Date("2026-11-27T07:00:00Z");
const clock = () => now;
const window = { period_start: "2026-11-23", period_end: "2026-11-29", next_period_start: "2026-11-30", next_period_end: "2026-12-06" };

async function fixture() {
  const repository = new InMemoryLightTickRepository();
  const { goal } = await new LightTickProfileService(repository, clock).submitOnboarding(owner, {
    title: "Practice a project briefing", timezone: "Asia/Shanghai", weeklyAvailableMinutes: 180,
    currentLevel: "Starting out", pace: "balanced",
  });
  const goals = new LightTickGoalService(repository, clock);
  await goals.update(owner, goal.id, goal.version, { targetDate: "2026-12-03" });
  const otherGoal = await goals.create(owner, { title: "UNRELATED_GOAL_PRIVATE", constraints: {} });
  const plans = new LightTickPlanService(repository, clock);
  const create = async (goalId: string, title: string) => {
    const plan = await plans.createProposed(owner, { goalId, granularity: "week", periodStart: window.period_start,
      periodEnd: window.period_end, source: "template", tasks: [{ title, scheduledFor: "2026-11-27", estimatedMinutes: 40 }] });
    return (await plans.confirm(owner, plan.id, plan.version)).tasks[0];
  };
  const original = await create(goal.id, "Outline a project briefing");
  const unrelated = await create(otherGoal.id, "UNRELATED_TASK_PRIVATE");
  const tasks = new LightTickTaskService(repository, clock);
  await tasks.command(owner, unrelated.id, unrelated.version, { action: "complete", notes: "UNRELATED_RESULT_PRIVATE" });
  const partial = (await tasks.progress(owner, original.id, original.version, {
    action: "record_partial", outcome: "TASK_OUTCOME_PRIVATE", remainingWork: "TASK_REMAINING_PRIVATE",
    actualMinutes: 7, estimate: 20,
  })).task;
  const source = await new LightTickReflectionService(repository, clock).save(owner, "reflection-one", {
    goal_id: goal.id, period_start: window.period_start, period_end: window.period_end, base_version: 0,
    content: "Selected sentence. OTHER_REFLECTION_PRIVATE", next_action: "OTHER_NEXT_ACTION_PRIVATE",
  });
  const context = await loadNextWeekContext(repository, owner, goal.id, { ...window, source: {
    reflection_id: source.id, reflection_version: source.version, excerpt: "Selected sentence.",
  } }, now);
  return { repository, goal, partial, context, tasks };
}

function proposal(context: NextWeekContext) {
  const source = context.carry_sources[0]!;
  return { decision: "adjust", summary: "Set one short continuation for next week.", tasks: [{
    title: "Finish the briefing outline", scheduled_for: "2026-12-01", estimated_minutes: 20,
    completion_criteria: "Draft a one-sentence conclusion and two supporting figures.",
    reason: "Continue from the partial practice.", evidence_ids: [source.evidence_ids[0]!], source_task_id: source.id,
  }] };
}

function model(result: unknown, inspect?: (request: LLMCompletionRequest) => Promise<void> | void) {
  return { complete: async (request: LLMCompletionRequest) => {
    await inspect?.(request);
    return { text: JSON.stringify(result), provider: "test-model", providerModel: "test" };
  } };
}

test("next week is Monday–Sunday in business time, and a frozen range survives the boundary", async () => {
  assert.deepEqual(nextWeekRange(new Date("2026-11-22T15:59:00Z"), "Asia/Shanghai"), { start: "2026-11-23", end: "2026-11-29" });
  assert.deepEqual(nextWeekRange(new Date("2026-11-22T16:01:00Z"), "Asia/Shanghai"), { start: "2026-11-30", end: "2026-12-06" });
  const { repository, context } = await fixture();
  const current = await assertNextWeekContextCurrent(repository, owner, context, new Date("2026-11-30T02:00:00Z"));
  assert.equal(current.fingerprint, context.fingerprint);
  assert.equal(current.next_period_start, "2026-11-30");
  await assert.rejects(loadNextWeekContext(repository, owner, context.goal_id, {
    ...window, source: { ...context.source!, excerpt: "A sentence never selected." },
  }, now), (error: any) => error.code === "LIGHTTICK_VERSION_CONFLICT");
});

test("only approved evidence reaches the model; successful output leaves the plan unchanged", async () => {
  const { repository, goal, context } = await fixture();
  const before = await repository.listTasks(owner);
  const run = await createLightTickAiRun(repository, owner, "next_week_advice", "next_week_advice", goal.id, { next_week: context }, now.toISOString());
  const provider = model(proposal(context), request => {
    const prompt = request.messages.at(-1)!.content!;
    assert.match(prompt, /Selected sentence\./u);
    assert.match(prompt, /"target_date":"2026-12-03"/u);
    assert.doesNotMatch(prompt, /_PRIVATE|fingerprint|reflection_version/u);
    assert.equal(request.providerOptions?.zookLogBodyMode, "suppress");
  });
  const updated = await new LightTickAiRunner(repository, provider as any, clock, undefined, undefined, async () => true)
    .execute(owner, run.id, "next_week_advice");
  assert.equal(updated.status, "succeeded");
  assert.equal((updated.output?.tasks as { id: string }[])[0].id, "step-1");
  assert.deepEqual(await repository.listTasks(owner), before);
  assert.ok((await repository.listPlans(owner, goal.id)).every(plan => plan.status === "active"));
});

test("rejects fabricated IDs, shortened carry and dates beyond the deadline", async () => {
  const { context } = await fixture();
  const output = proposal(context);
  const task = output.tasks[0];
  for (const invalid of [
    { ...task, evidence_ids: ["fabricated"] },
    { ...task, estimated_minutes: 19 },
    { ...task, scheduled_for: "2026-12-04" },
    { ...task, id: "model-supplied-id" },
  ]) assert.throws(() => validateNextWeekAdvice({ ...output, tasks: [invalid] }, context));
  assert.throws(() => validateNextWeekAdvice({ ...output, tasks: [task, { ...task, title: "Another continuation" }] }, context));
});

test("provider disabled before dispatch and a changed source during dispatch cannot produce advice", async () => {
  const { repository, goal, context, tasks, partial } = await fixture();
  const queue = () => createLightTickAiRun(repository, owner, "next_week_advice", "next_week_advice", goal.id, { next_week: context }, now.toISOString());
  let calls = 0;
  const off = await queue();
  const unavailable = await new LightTickAiRunner(repository, model(proposal(context), () => { calls++; }) as any, clock)
    .execute(owner, off.id, "next_week_advice");
  assert.equal(unavailable.status, "failed");
  assert.equal(calls, 0);
  const on = await queue();
  const changed = await new LightTickAiRunner(repository, model(proposal(context), async () => {
    calls++;
    await tasks.progress(owner, partial.id, partial.version, { action: "set_remaining", estimate: 25 });
  }) as any, clock, undefined, undefined, async () => true).execute(owner, on.id, "next_week_advice");
  assert.equal(calls, 1);
  assert.equal(changed.status, "failed");
  assert.equal(changed.errorCode, "LIGHTTICK_VERSION_CONFLICT");
  assert.equal(changed.output, undefined);
});

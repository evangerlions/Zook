import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickProposalService } from "../../src/modules/lighttick/lighttick-proposal.service.ts";
import { LightTickReflectionService } from "../../src/modules/lighttick/lighttick-reflection.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { GoalConditionsService } from "../../src/modules/lighttick/goal-context/goal-conditions.service.ts";

const owner = { appId: "lighttick", userId: "bypass-owner" } as const;
const now = "2026-10-31T04:00:00.000Z";
const clock = () => new Date(now);

async function fixture() {
  const repository = new InMemoryLightTickRepository();
  const goals = new LightTickGoalService(repository, clock);
  const plans = new LightTickPlanService(repository, clock);
  const tasks = new LightTickTaskService(repository, clock);
  const proposals = new LightTickProposalService(repository, clock);
  const conditions = new GoalConditionsService(repository, clock);
  const goal = await goals.create(owner, { title: "Explain clearly", constraints: {} });
  const draft = await plans.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-11-01", periodEnd: "2026-11-07", source: "template",
    tasks: [{ title: "Existing action", estimatedMinutes: 10, scheduledFor: "2026-11-01" }] });
  const active = await plans.confirm(owner, draft.id, draft.version);
  const budget = async () => conditions.confirm(owner, goal.id, "confirm-daily-budget", {
    id: "confirmed-budget", base_version: (await goals.get(owner, goal.id)).version,
    condition_version: 0, scope: "ongoing", starts_on: "2026-11-01", ends_on: null,
    daily_minutes: 20, active: true, reason: "Twenty minutes are available each day",
  });
  const proposal = async (planId = active.plan.id, taskId = active.tasks[0].id, minutes = 15) => {
    const plan = (await repository.getPlan(owner, planId))!;
    return repository.saveProposal({ ...owner, id: "ordinary-proposal", planId,
      basePlanVersion: plan.version, status: "pending", reason: "Review task effort",
      diff: [{ action: "update_task", task_id: taskId, estimated_minutes: minutes }], impact: {},
      expiresAt: "2026-11-07T00:00:00.000Z", version: 1, createdAt: now, updatedAt: now });
  };
  return { repository, goals, plans, tasks, proposals, conditions, goal, active, budget, proposal };
}

async function snapshot(repository: InMemoryLightTickRepository) {
  return { goals: await repository.listGoals(owner), plans: await repository.listPlans(owner),
    tasks: await repository.listTasks(owner), proposals: await repository.listProposals(owner),
    reflections: await repository.listReflections(owner), events: await repository.listExecutionEvents(owner),
    changes: await repository.pullChanges(owner, 0, 1000) };
}

test("ordinary proposal supersession never releases a consumed reflection revision", async () => {
  const { repository, goals, proposals, goal, active, proposal } = await fixture();
  const manual = new ManualPlanningService(repository, clock);
  const reflection = await new LightTickReflectionService(repository, clock).save(owner, "selected-reflection", {
    goal_id: goal.id, plan_id: active.plan.id, period_start: "2026-10-31", period_end: "2026-10-31",
    content: "One concrete example helped", next_action: "Review a smaller example", base_version: 0,
  });
  const input = (title: string) => ({ goal_id: goal.id, title: "Explain clearly", completion_criteria: "One example",
    period_start: "2026-11-01", period_end: "2026-11-07", source_reflection_id: reflection.id,
    source_reflection_version: reflection.version,
    tasks: [{ id: title, title, scheduled_for: "2026-11-01", estimated_minutes: 5, completion_criteria: "One example", guidance: "" }] });
  const firstDraft = await manual.create(owner, "first-source-create", input("Reviewed next action"));
  const second = await manual.create(owner, "second-source-create", input("Different next action"));
  const first = await manual.confirm(owner, firstDraft.id, "first-source-confirm", {
    base_version: firstDraft.version, goal_base_version: firstDraft.goal_version,
  });
  const offered = await proposal(first.id, first.tasks[0].id, 6);
  await proposals.accept(owner, offered.id, offered.version);
  assert.equal((await repository.getPlan(owner, first.id))?.status, "superseded");
  const before = await snapshot(repository);
  await assert.rejects(manual.confirm(owner, second.id, "second-source-confirm", {
    base_version: second.version, goal_base_version: (await goals.get(owner, goal.id)).version,
  }), { statusCode: 409 });
  assert.deepEqual(await snapshot(repository), before);
  assert.equal(await repository.getOperation(owner, "second-source-confirm"), undefined);
});

for (const state of ["paused", "recovering"] as const) {
  for (const variant of ["light", "minimum"] as const) {
    test(`${state} legacy goals permit switching a standard task to ${variant}`, async () => {
      const { repository, goals, tasks, goal, active } = await fixture();
      const original = active.tasks[0];
      const seeded = await repository.saveTask({ ...original, variantDefinitions: {
        standard: { title: "Standard example", estimatedMinutes: 10, completionCriteria: "Full example" },
        light: { title: "Light example", estimatedMinutes: 5, completionCriteria: "Small example" },
        minimum: { title: "Minimum example", estimatedMinutes: 1, completionCriteria: "Start once" },
      } }, {
        event: { ...owner, id: "seed-variants", aggregateType: "task", aggregateId: original.id,
          eventType: "fixture_variants", aggregateVersion: original.version + 1, payload: {}, occurredAt: now, createdAt: now },
        change: { ...owner, entityType: "task", entityId: original.id, entityVersion: original.version + 1,
          operation: "upsert", changedAt: now },
      }, original.version);
      let stopped = await goals.transition(owner, goal.id, (await goals.get(owner, goal.id)).version, "pause", {
        keepLightTasks: true, notificationPolicy: "light_only",
      });
      if (state === "recovering") stopped = await goals.transition(owner, goal.id, stopped.version, "resume", { resumeMode: "recovery_mode" });
      const switched = await tasks.switchVariant(owner, seeded.id, seeded.version, variant);
      assert.equal(switched.selectedVariant, variant);
      const completed = await tasks.command(owner, switched.id, switched.version, { action: "complete", actualMinutes: 2 });
      assert.equal(completed.status, "completed");
      assert.equal(completed.commitmentSatisfied, false);
      assert.deepEqual(await goals.get(owner, goal.id), stopped);
    });
  }
}

test("ordinary plan confirmation enforces confirmed daily capacity before any writes", async () => {
  const { repository, plans, goal, budget } = await fixture();
  await budget();
  const draft = await plans.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-11-01", periodEnd: "2026-11-07", source: "ai",
    tasks: [{ title: "Additional 30-minute action", estimatedMinutes: 30, scheduledFor: "2026-11-01" }] });
  const before = await snapshot(repository);
  await assert.rejects(plans.confirm(owner, draft.id, draft.version), { statusCode: 422 });
  assert.deepEqual(await snapshot(repository), before);
});

for (const lifecycle of ["pause", "complete", "archive"] as const) {
  test(`ordinary plan confirmation cannot materialize work after goal ${lifecycle}`, async () => {
    const { repository, goals, plans, goal } = await fixture();
    const draft = await plans.createProposed(owner, { goalId: goal.id, granularity: "week",
      periodStart: "2026-11-01", periodEnd: "2026-11-07", source: "ai",
      tasks: [{ title: "Cached proposed action", estimatedMinutes: 5, scheduledFor: "2026-11-01" }] });
    await goals.transition(owner, goal.id, (await goals.get(owner, goal.id)).version, lifecycle);
    const before = await snapshot(repository);
    await assert.rejects(plans.confirm(owner, draft.id, draft.version), { statusCode: 409 });
    assert.deepEqual(await snapshot(repository), before);
  });
}

for (const lifecycle of ["pause", "complete", "archive"] as const) {
  test(`ordinary proposal acceptance cannot change work after goal ${lifecycle}`, async () => {
    const { repository, goals, proposals, goal, proposal } = await fixture();
    const offered = await proposal();
    await goals.transition(owner, goal.id, (await goals.get(owner, goal.id)).version, lifecycle);
    const before = await snapshot(repository);
    await assert.rejects(proposals.accept(owner, offered.id, offered.version), { statusCode: 409 });
    assert.deepEqual(await snapshot(repository), before);
  });
}

test("ordinary proposal acceptance cannot exceed confirmed capacity or partially supersede the plan", async () => {
  const { repository, proposals, budget, proposal } = await fixture();
  await budget();
  const offered = await proposal(undefined, undefined, 30);
  const before = await snapshot(repository);
  await assert.rejects(proposals.accept(owner, offered.id, offered.version), { statusCode: 422 });
  assert.deepEqual(await snapshot(repository), before);
});
test('proposal supersession preserves completed task identity/history and today facts',async()=>{
 const {repository,tasks,proposals,active,proposal}=await fixture();
 const original=active.tasks[0],pending=await repository.saveTask({...original,id:'pending-second',title:'Another pending action',estimatedMinutes:5,version:1},{event:{...owner,id:'seed-second',aggregateType:'task',aggregateId:'pending-second',eventType:'seed',aggregateVersion:1,payload:{},occurredAt:now,createdAt:now},change:{...owner,entityType:'task',entityId:'pending-second',entityVersion:1,operation:'upsert',changedAt:now}});
 const completed=await tasks.command(owner,original.id,original.version,{action:'complete',actualMinutes:7});
 const offered=await proposal(active.plan.id,pending.id,6);await proposals.accept(owner,offered.id,offered.version);
 assert.deepEqual(await repository.getTask(owner,completed.id),completed);
 const {LightTickTodayService}=await import('../../src/modules/lighttick/lighttick-today.service.ts');
 assert.equal((await new LightTickTodayService(repository,()=>new Date('2026-11-01T04:00:00Z')).get(owner)).completedTasks.some(t=>t.id===completed.id),true);
});
test('a proposal reviewed before completion cannot rewrite completed facts',async()=>{
 const {repository,tasks,proposals,active,proposal}=await fixture();const offered=await proposal();
 await tasks.command(owner,active.tasks[0].id,active.tasks[0].version,{action:'complete',actualMinutes:7});const before=await snapshot(repository);
 await assert.rejects(proposals.accept(owner,offered.id,offered.version),{statusCode:409});assert.deepEqual(await snapshot(repository),before);
});
test('a task intensity change cannot bypass the latest confirmed daily limit',async()=>{
 const {repository,tasks,active,budget}=await fixture();await budget();const t=active.tasks[0];
 const seeded=await repository.saveTask({...t,selectedVariant:'light',estimatedMinutes:5,variantDefinitions:{standard:{title:'Large example',estimatedMinutes:30,completionCriteria:'Full'},light:{title:'Small',estimatedMinutes:5,completionCriteria:'Small'},minimum:{title:'Start',estimatedMinutes:1,completionCriteria:'Start'}}},{event:{...owner,id:'seed-intensity',aggregateType:'task',aggregateId:t.id,eventType:'seed',aggregateVersion:t.version+1,payload:{},occurredAt:now,createdAt:now},change:{...owner,entityType:'task',entityId:t.id,entityVersion:t.version+1,operation:'upsert',changedAt:now}},t.version);
 const before=await snapshot(repository);await assert.rejects(tasks.switchVariant(owner,seeded.id,seeded.version,'standard'),{statusCode:422});assert.deepEqual(await snapshot(repository),before);
});

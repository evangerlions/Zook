import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "native-lifecycle-owner" } as const;
const now = "2026-10-31T04:00:00.000Z";
const clock = () => new Date(now);

async function fixture() {
  const repository = new InMemoryLightTickRepository();
  const goals = new LightTickGoalService(repository, clock);
  const tasks = new LightTickTaskService(repository, clock);
  const manual = new ManualPlanningService(repository, clock);
  const draft = await manual.create(owner, "lifecycle-create", {
    title: "Practice clear explanations",
    completion_criteria: "Explain a concrete example",
    period_start: "2026-10-31",
    period_end: "2026-11-06",
    tasks: [
      { id: "today", title: "Explain today's example", scheduled_for: "2026-10-31",
        estimated_minutes: 15, completion_criteria: "One clear example", guidance: "" },
      { id: "future", title: "Explain a future example", scheduled_for: "2026-11-02",
        estimated_minutes: 20, completion_criteria: "One clear example", guidance: "" },
      { id: "undated", title: "Choose another example", scheduled_for: null,
        estimated_minutes: null, completion_criteria: "", guidance: "" },
    ],
  });
  const plan = await manual.confirm(owner, draft.id, "lifecycle-confirm", {
    base_version: draft.version, goal_base_version: draft.goal_version,
  });
  const all = await repository.listTasks(owner);
  const today = all.find(task => task.scheduledFor === "2026-10-31")!;
  const future = all.find(task => task.scheduledFor === "2026-11-02")!;
  return { repository, goals, tasks, manual, plan, today, future };
}

async function snapshot(repository: InMemoryLightTickRepository) {
  return {
    goals: await repository.listGoals(owner),
    plans: await repository.listPlans(owner),
    tasks: await repository.listTasks(owner),
    events: await repository.listExecutionEvents(owner),
    changes: await repository.pullChanges(owner, 0, 1000),
  };
}

for (const action of ["start", "complete"] as const) {
  test(`paused manual goals reject stale ${action} commands without changing execution state`, async () => {
    const { repository, goals, tasks, plan, today } = await fixture();
    const paused = await goals.transition(owner, plan.goal_id, plan.goal_version, "pause");
    assert.equal(paused.pauseMetadata?.keepLightTasks, false);
    assert.equal(paused.pauseMetadata?.notificationPolicy, "suppress");
    assert.deepEqual((await new LightTickTodayService(repository, clock).get(owner)).executableTasks, []);
    const before = await snapshot(repository);

    // The task version is still the version cached before pause; the goal changed independently.
    await assert.rejects(tasks.command(owner, today.id, today.version, { action }), { statusCode: 409 });

    assert.deepEqual(await snapshot(repository), before);
  });
}

test("pausing a manual goal also rejects completion of a task already in progress", async () => {
  const { repository, goals, tasks, plan, today } = await fixture();
  const started = await tasks.command(owner, today.id, today.version, { action: "start" });
  await goals.transition(owner, plan.goal_id, plan.goal_version, "pause");
  const before = await snapshot(repository);
  await assert.rejects(tasks.command(owner, today.id, started.version, { action: "complete" }), { statusCode: 409 });
  assert.deepEqual(await snapshot(repository), before);
});

for (const variant of ["light", "minimum"] as const) {
  test(`explicit legacy keepLightTasks preserves ${variant} execution while paused`, async () => {
    const repository = new InMemoryLightTickRepository();
    const goals = new LightTickGoalService(repository, clock);
    const tasks = new LightTickTaskService(repository, clock);
    const draft = await goals.create(owner, { title: "Legacy goal", constraints: {} });
    const write = (entityType: string, entityId: string, version: number) => ({
      event: { ...owner, id: `${entityId}-${version}`, aggregateType: entityType, aggregateId: entityId,
        eventType: "fixture_created", aggregateVersion: version, payload: {}, occurredAt: now, createdAt: now },
      change: { ...owner, entityType, entityId, entityVersion: version, operation: "upsert" as const, changedAt: now },
    });
    const active = await repository.saveGoal({ ...draft, status: "active" }, write("goal", draft.id, 2), draft.version);
    const task = await repository.saveTask({ ...owner, id: "legacy-task", goalId: active.id,
      planId: "legacy-plan", title: "Full action", status: "pending", priority: 1,
      estimatedMinutes: 30, version: 1, createdAt: now, updatedAt: now,
      variantDefinitions: {
        standard: { title: "Full action", estimatedMinutes: 30, completionCriteria: "Full result" },
        light: { title: "Light action", estimatedMinutes: 10, completionCriteria: "Small result" },
        minimum: { title: "Minimum action", estimatedMinutes: 2, completionCriteria: "Start once" },
      },
    }, write("task", "legacy-task", 1));
    const selected = await tasks.switchVariant(owner, task.id, task.version, variant);
    await goals.transition(owner, active.id, active.version, "pause", {
      keepLightTasks: true, notificationPolicy: "light_only",
    });

    const started = await tasks.command(owner, task.id, selected.version, { action: "start" });
    const completed = await tasks.command(owner, task.id, started.version, { action: "complete" });

    assert.equal(completed.status, "completed");
    assert.equal(completed.selectedVariant, variant);
    assert.equal(completed.commitmentSatisfied, false);
    assert.equal((await goals.get(owner, active.id)).status, "paused");
  });
}

for (const lifecycle of ["complete", "archive"] as const) {
  for (const action of ["start", "complete"] as const) {
    test(`${lifecycle} preserves manual completion history and rejects stale future ${action}`, async () => {
      const { repository, goals, tasks, manual, plan, today, future } = await fixture();
      const completed = await tasks.command(owner, today.id, today.version, {
        action: "complete", actualMinutes: 12, notes: "A concrete example was explained",
      });
      const completionEvents = (await repository.listExecutionEvents(owner)).filter(event => event.aggregateId === today.id);
      await goals.transition(owner, plan.goal_id, plan.goal_version, lifecycle);

      assert.deepEqual(await repository.getTask(owner, today.id), completed);
      assert.deepEqual((await repository.listExecutionEvents(owner)).filter(event => event.aggregateId === today.id), completionEvents);
      assert.equal((await manual.get(owner, plan.id)).tasks.find(task => task.id === today.id)?.status, "completed");
      const futureToday = await new LightTickTodayService(repository, () => new Date("2026-11-02T04:00:00Z")).get(owner);
      assert.deepEqual(futureToday.executableTasks, []);
      const before = await snapshot(repository);

      await assert.rejects(tasks.command(owner, future.id, future.version, { action }), { statusCode: 409 });

      assert.deepEqual(await snapshot(repository), before);
    });
  }
}

for (const resumeMode of [undefined, "original_pace", "recovery_mode"] as const) {
  test(`manual resume with outstanding tasks requires review (${resumeMode ?? "default"})`, async () => {
    const { repository, goals, plan } = await fixture();
    const paused = await goals.transition(owner, plan.goal_id, plan.goal_version, "pause");
    const before = await snapshot(repository);

    await assert.rejects(goals.transition(owner, paused.id, paused.version, "resume",
      resumeMode === undefined ? {} : { resumeMode }), { statusCode: 409 });

    assert.deepEqual(await snapshot(repository), before);
    assert.equal((await goals.get(owner, paused.id)).status, "paused");
    assert.deepEqual((await new LightTickTodayService(repository, clock).get(owner)).executableTasks, []);
  });
}

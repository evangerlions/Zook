import assert from "node:assert/strict";
import test from "node:test";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { setTaskPrerequisite } from "../../src/modules/lighttick/planning/task-prerequisite.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTodayService, businessDateAt } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const instant = new Date("2026-08-20T16:30:00Z");

test("Today uses IANA business date, active plan, priority, and remaining duration", async () => {
  const repository = new InMemoryLightTickRepository();
  const onboarding = await new LightTickProfileService(repository, () => instant).submitOnboarding(owner, {
    title: "Launch", currentLevel: "Ready", weeklyAvailableMinutes: 300, pace: "balanced", timezone: "Asia/Shanghai",
  });
  const plans = new LightTickPlanService(repository, () => instant);
  const proposed = await plans.createProposed(owner, { goalId: onboarding.goal.id, granularity: "day",
    periodStart: "2026-08-21", periodEnd: "2026-08-21", source: "template", tasks: [
      { title: "Main", estimatedMinutes: 50, priority: 20, scheduledFor: "2026-08-20T16:00:00Z" },
      { title: "Backup", estimatedMinutes: 30, priority: 10, scheduledFor: "2026-08-21T01:00:00Z" },
      { title: "Tomorrow", estimatedMinutes: 90, priority: 99, scheduledFor: "2026-08-21T16:00:00Z" },
    ] });
  await plans.confirm(owner, proposed.id, 1);
  const today = await new LightTickTodayService(repository, () => instant).get(owner);
  assert.equal(today.businessDate, "2026-08-21");
  assert.equal(today.primaryTask?.title, "Main");
  assert.equal(today.executableTasks.length, 2);
  assert.equal(today.remainingEstimatedMinutes, 80);
  assert.equal(today.planBAvailable, true);
});

test("Today returns documented empty state and preserves timezone boundary", async () => {
  const repository = new InMemoryLightTickRepository();
  const today = await new LightTickTodayService(repository, () => instant).get(owner);
  assert.equal(today.emptyState, "no_active_plan");
  assert.equal(today.businessDate, "2026-08-20");
  assert.equal(businessDateAt(instant, "Asia/Shanghai"), "2026-08-21");
  assert.equal(businessDateAt(instant, "America/Los_Angeles"), "2026-08-20");
});

for (const action of ["pause", "complete", "archive"] as const) {
  test(`Today retains completed facts when an ordinary goal is stopped by ${action}`, async () => {
    const repository = new InMemoryLightTickRepository();
    const clock = () => instant;
    const tasks = new LightTickTaskService(repository, clock);
    const goals = new LightTickGoalService(repository, clock);
    const manual = new ManualPlanningService(repository, clock);
    const legacy = new LightTickPlanService(repository, clock);
    const service = new LightTickTodayService(repository, clock);
    const date = "2026-08-21", yesterday = "2026-08-20";
    await new LightTickProfileService(repository, clock).updateProfile(owner, 0, { timezone: "Asia/Shanghai" });
    const actionData = (title: string, scheduled_for: string | null = date) => ({
      id: title, title, scheduled_for, estimated_minutes: 10, completion_criteria: "", guidance: "",
    });
    const initial = await manual.create(owner, "today-stop-seed", {
      title: "Closing one goal", completion_criteria: "Publish a report", period_start: yesterday, period_end: date,
      tasks: [actionData("Completed scheduled"), actionData("Pending prerequisite"), actionData("Waiting"),
        actionData("Blocked"), actionData("Missed", yesterday), actionData("Undated manual", null)],
    });
    const confirmed = await manual.confirm(owner, initial.id, "today-stop-confirm",
      { base_version: initial.version, goal_base_version: initial.goal_version });
    const [done, pending, waiting, blocked, missed, undated] = confirmed.tasks;
    const finished = await tasks.command(owner, done.id, done.version, { action: "complete", actualMinutes: 7, notes: "Evidence kept" });
    await tasks.command(owner, undated.id, undated.version, { action: "complete" });
    await tasks.progress(owner, waiting.id, waiting.version, { action: "wait", reason: "External input" });
    await repository.transaction(owner, async () => {
      await repository.lockPlanningOwner(owner);
      await setTaskPrerequisite(repository, owner, blocked.id, { base_version: blocked.version, prerequisite_task_id: pending.id }, instant);
    });
    const oldDraft = await legacy.createProposed(owner, {
      goalId: confirmed.goal_id, source: "template", granularity: "day", periodStart: date, periodEnd: date,
      tasks: [{ title: "Legacy undated", estimatedMinutes: 10 },
        { title: "Legacy local instant", estimatedMinutes: 10, scheduledFor: "2026-08-20T16:31:00Z" }],
    });
    const old = await legacy.confirm(owner, oldDraft.id, oldDraft.version);
    for (const task of old.tasks) await tasks.command(owner, task.id, task.version, { action: "complete" });
    await repository.savePlan({ ...old.plan, status: "superseded" }, {
      event: { ...owner, id: "test-old-plan-superseded", aggregateType: "plan", aggregateId: old.plan.id,
        eventType: "plan_superseded", aggregateVersion: old.plan.version + 1, payload: {}, occurredAt: instant.toISOString(), createdAt: instant.toISOString() },
      change: { ...owner, entityType: "plan", entityId: old.plan.id, entityVersion: old.plan.version + 1, operation: "upsert",
        snapshot: { status: "superseded" }, changedAt: instant.toISOString() },
    }, old.plan.version);

    const other = await manual.create(owner, "today-other-draft", {
      title: "Keep this goal", completion_criteria: "", period_start: date, period_end: date, tasks: [actionData("Other action")],
    });
    const otherPlan = await manual.confirm(owner, other.id, "today-other-confirm", { base_version: other.version, goal_base_version: other.goal_version });
    const before = await service.get(owner);
    const completedIds = [finished.id, ...old.tasks.map(task => task.id)].sort();
    assert.deepEqual(before.completedTasks.map(task => task.id).sort(), completedIds);
    assert.ok(before.executableTasks.some(task => task.id === pending.id));
    assert.ok(before.waitingTasks.some(task => task.id === waiting.id));
    assert.ok(before.prerequisiteWaitingTasks?.some(task => task.id === blocked.id));
    assert.ok(before.missedTasks?.some(task => task.id === missed.id));
    assert.ok(before.cycleHandoffs?.some(cycle => cycle.goalId === confirmed.goal_id));

    const goal = await goals.get(owner, confirmed.goal_id);
    await goals.transition(owner, goal.id, goal.version, action);
    const preserved = await service.get(owner);
    assert.deepEqual(preserved.completedTasks.map(task => task.id).sort(), completedIds);
    assert.deepEqual(preserved.completedTasks.find(task => task.id === done.id), finished);
    assert.deepEqual(preserved.executableTasks.map(task => task.id), [otherPlan.tasks[0].id]);
    assert.equal(preserved.primaryTask?.id, otherPlan.tasks[0].id);
    assert.equal(preserved.remainingEstimatedMinutes, 10);
    assert.ok(!preserved.waitingTasks.length && !preserved.prerequisiteWaitingTasks?.length && !preserved.missedTasks?.length);
    assert.deepEqual(preserved.cycleHandoffs?.map(cycle => cycle.goalId), [otherPlan.goal_id]);
    await assert.rejects(tasks.command(owner, pending.id, pending.version, { action: "complete" }),
      { code: "LIGHTTICK_STATE_TRANSITION_INVALID" });
    const otherGoal = await goals.get(owner, otherPlan.goal_id);
    await goals.transition(owner, otherGoal.id, otherGoal.version, "complete");
    const onlyHistory = await service.get(owner);
    assert.deepEqual(onlyHistory.completedTasks.map(task => task.id).sort(), completedIds);
    assert.equal(onlyHistory.primaryTask, undefined);
    assert.equal(onlyHistory.emptyState, undefined);
  });
}

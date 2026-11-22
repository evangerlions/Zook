import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("Disposable Grow fixture database required");
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

test("Today reads plans, goals, tasks and steps at one owner commit boundary", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn, max: 6 });
  const repo = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "today-snapshot-" + process.pid };
  const clock = () => new Date("2026-11-04T08:00:00Z");
  const read = signal(), release = signal();
  let writer: Promise<unknown> | undefined, reader: Promise<unknown> | undefined;
  try {
    const onboarding = await new LightTickProfileService(repo, clock).submitOnboarding(owner, {
      title: "Snapshot", currentLevel: "Ready", weeklyAvailableMinutes: 300, pace: "balanced", timezone: "Asia/Shanghai",
    });
    const plans = new LightTickPlanService(repo, clock);
    const propose = (title: string) => plans.createProposed(owner, {
      goalId: onboarding.goal.id, granularity: "day", periodStart: "2026-11-04", periodEnd: "2026-11-04", source: "template",
      tasks: [{ title, estimatedMinutes: 20, scheduledFor: "2026-11-04" }],
    });
    const old = await plans.confirm(owner, (await propose("Before continuation")).id, 1);
    const next = await propose("After continuation");
    const step = await repo.saveTaskStep({ ...owner, id: "snapshot-step", taskId: old.tasks[0].id,
      title: "Before step edit", position: 0, completed: false, version: 1, createdAt: clock().toISOString(), updatedAt: clock().toISOString() });
    const listPlans = repo.listPlans.bind(repo);
    let intercept = true;
    repo.listPlans = async (...args) => {
      const result = await listPlans(...args);
      if (intercept) { intercept = false; read.resolve(); await release.promise; }
      return result;
    };
    const today = new LightTickTodayService(repo, clock);
    const snapshot = today.get(owner); reader = snapshot;
    await read.promise;
    let committed = false;
    writer = repo.transaction(owner, async () => {
      // These writes model an atomic continuation while a Today request is in flight.
      await pool.query("SELECT 1");
      const write = (kind: string, id: string, version: number) => ({
        event: { ...owner, id: `${kind}-${process.pid}`, aggregateType: kind as "task" | "plan", aggregateId: id,
          eventType: "snapshot_fixture", aggregateVersion: version + 1, payload: {}, occurredAt: clock().toISOString(), createdAt: clock().toISOString() },
        change: { ...owner, entityType: kind, entityId: id, entityVersion: version + 1,
          operation: "upsert" as const, snapshot: {}, changedAt: clock().toISOString() },
      });
      await repo.saveTask({ ...old.tasks[0], status: "cancelled" }, write("task", old.tasks[0].id, old.tasks[0].version), old.tasks[0].version);
      await repo.savePlan({ ...old.plan, status: "superseded" }, write("plan", old.plan.id, old.plan.version), old.plan.version);
      await repo.saveTaskStep({ ...step, title: "After step edit" }, step.version);
      await plans.confirm(owner, next.id, 1);
    }).then(() => { committed = true; });
    await Promise.race([writer, new Promise(resolve => setTimeout(resolve, 150))]);
    assert.equal(committed, false, "continuation must wait for the complete Today read");
    release.resolve();
    const before = await snapshot;
    assert.deepEqual(before.executableTasks.map(task => task.title), ["Before continuation"]);
    assert.equal(before.taskSteps[0].title, "Before step edit");
    await writer;
    const after = await today.get(owner);
    assert.deepEqual(after.executableTasks.map(task => task.title), ["After continuation"]);
    assert.deepEqual(after.taskSteps, []);
  } finally {
    release.resolve();
    await Promise.allSettled([reader, writer]);
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

test("closed goal facts and the owner criterion survive confirmed plan changes and a new repository instance", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn, max: 6 });
  const repo = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "today-closure-" + process.pid };
  const clock = () => new Date("2026-11-04T16:30:00Z");
  const localDay = "2026-11-05";
  try {
    await new LightTickProfileService(repo, clock).updateProfile(owner, 0, { timezone: "Asia/Shanghai" });
    const goals = new LightTickGoalService(repo, clock);
    const manual = new ManualPlanningService(repo, clock);
    const executor = new LightTickTaskService(repo, clock);
    async function arrange(key: string, completion_criteria: string, goal_id?: string) {
      const draft = await manual.create(owner, "draft-" + key, {
        goal_id, title: key, completion_criteria, period_start: localDay, period_end: localDay,
        tasks: [{ id: key, title: key, scheduled_for: localDay, estimated_minutes: 12, completion_criteria: "", guidance: "" }],
      });
      return manual.confirm(owner, draft.id, "confirm-" + key, { base_version: draft.version, goal_base_version: draft.goal_version });
    }
    const first = await arrange("Proof of outcome", "Publish the complete report");
    const later = await arrange("Draft two lines", "Write a short outline", first.goal_id);
    const unrelated = await arrange("Separate growth task", "");
    const finished = first.tasks[0];
    await executor.command(owner, finished.id, finished.version, { action: "complete", actualMinutes: 8, notes: "Used actual numbers" });
    const today = new LightTickTodayService(repo, clock);
    assert.ok((await today.get(owner)).executableTasks.some(task => task.id === later.tasks[0].id));
    const goal = await goals.get(owner, first.goal_id);
    assert.equal(goal.constraints.completion_criteria, "Publish the complete report");
    assert.equal(later.draft.completion_criteria, "Write a short outline");
    const complete = await goals.transition(owner, goal.id, goal.version, "complete");
    await goals.transition(owner, goal.id, complete.version, "archive");

    const reopened = new PostgresLightTickRepository(pool);
    const preserved = await new LightTickTodayService(reopened, clock).get(owner);
    assert.equal(preserved.businessDate, localDay);
    assert.deepEqual(preserved.completedTasks.map(task => [task.id, task.actualMinutes, task.notes]), [[finished.id, 8, "Used actual numbers"]]);
    assert.deepEqual(preserved.executableTasks.map(task => task.id), [unrelated.tasks[0].id]);
    assert.deepEqual(preserved.cycleHandoffs?.map(cycle => cycle.goalId), [unrelated.goal_id]);
    const stored = await reopened.getGoal(owner, goal.id);
    assert.equal(stored?.constraints.completion_criteria, "Publish the complete report");
    assert.equal(stored?.constraints.closure_outcome, "achieved");
    assert.equal((await reopened.getTask(owner, later.tasks[0].id))?.status, "pending");
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { GoalSubjectsService } from "../../src/modules/lighttick/planning/goal-subjects.service.ts";
import { assertWeeklyPlanningCapacity } from "../../src/modules/lighttick/planning/weekly-capacity.ts";
import { randomId } from "../../src/shared/utils.ts";

const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("LIGHTTICK_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");

test("PostgreSQL serializes subject admissions and retains the accepted plan and outcome evidence", async () => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const repository = new PostgresLightTickRepository(pool);
  const clock = () => new Date("2026-11-30T12:00:00Z");
  const date = "2026-11-30";
  const owner = { appId: "lighttick", userId: randomId("subjects_pg") };
  try {
    const { id: goalId } = await new LightTickGoalService(repository, clock).create(owner, {
      title: "A goal with two subjects", constraints: {},
    });
    const subjects = new GoalSubjectsService(repository, clock);
    const reading = { id: "read", title: "Read and reflect", outcome_criteria: "Explain the main idea",
      weekly_minutes: 25, priority: "high", archived: false };
    const writing = { ...reading, id: "write", title: "Write a paragraph", weekly_minutes: null };
    const initial = await subjects.update(owner, goalId, { base_version: 0, subjects: [reading, writing] });
    assert.equal(initial.version, 1);
    const plans = new LightTickPlanService(repository, clock);
    const proposed = await Promise.all(["Read an essay", "Read an interview"].map(title => plans.createProposed(owner, {
      goalId, source: "ai", granularity: "week", periodStart: date, periodEnd: "2026-12-06",
      tasks: [{ title, estimatedMinutes: 20, scheduledFor: date }], metadata: { subject_id: reading.id },
    })));
    const outcomes = await Promise.allSettled(proposed.map(plan => repository.transaction(owner, async () => {
      await repository.lockPlanningOwner(owner);
      await assertWeeklyPlanningCapacity(repository, owner,
        [{ scheduledFor: date, estimatedMinutes: 20, goalId, subjectId: reading.id }], { now: clock(), requireScheduledDate: true });
      return plans.confirm(owner, plan.id, plan.version);
    })));
    const accepted = outcomes.filter(result => result.status === "fulfilled");
    const rejected = outcomes.filter(result => result.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]!.reason.code, "LIGHTTICK_SUBJECT_WEEKLY_CAPACITY_EXCEEDED");
    const pending = accepted[0]!.value.tasks[0]!;
    const running = await subjects.get(owner, goalId);
    assert.equal(running.subjects[0]?.usage.known_minutes, 20);
    assert.equal(running.subjects[0]?.usage.remaining_minutes, 5);
    const work = await new LightTickTaskService(repository, clock).command(owner, pending.id, pending.version,
      { action: "complete", actualMinutes: 13 });
    assert.equal(work.status, "completed");
    const result = await subjects.recordOutcome(owner, goalId, reading.id, {
      base_version: 1, note: "I can explain the main idea.", task_id: pending.id,
    });
    assert.deepEqual(result.subjects[0]?.latest_outcome, {
      note: "I can explain the main idea.", task_id: pending.id, recorded_at: clock().toISOString(),
    });
    assert.equal(result.subjects[0]?.usage.known_minutes, 13);
    await assert.rejects(subjects.get({ ...owner, userId: owner.userId + "_other" }, goalId),
      (error: any) => error.status === 404 || error.code === "LIGHTTICK_RESOURCE_NOT_FOUND");
    assert.equal((await repository.listTasks(owner)).length, 1);
  } finally {
    await pool.end();
  }
});

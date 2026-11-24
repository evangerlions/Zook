import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { AnnualPlanningService } from "../../src/modules/lighttick/planning/annual-planning.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { readPlanningAgenda } from "../../src/modules/lighttick/planning/planning-agenda.ts";
import { randomId } from "../../src/shared/utils.ts";

const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("LIGHTTICK_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");

test("PostgreSQL rolls back stale batches and serializes competing annual confirmations", async () => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  const repository = new PostgresLightTickRepository(pool);
  const clock = () => new Date("2027-01-01T12:00:00Z");
  const owner = { appId: "lighttick", userId: randomId("annual_pg") };
  const goals = new LightTickGoalService(repository, clock);
  const roadmaps = new GoalRoadmapService(repository, clock);
  const annual = new AnnualPlanningService(repository, clock);
  try {
    const first = await goals.create(owner, { title: "First annual goal", constraints: {} });
    const second = await goals.create(owner, { title: "Second annual goal", constraints: {} });
    const stage = { id: "next", title: "Review a result", outcome_criteria: "State one next action",
      starts_on: "2027-01-01", ends_on: "2027-12-31" };
    await roadmaps.update(owner, second.id, { base_version: 0, stages: [stage] });
    const firstChange = { goal_id: first.id, base_version: 0, stages: [stage] };
    const secondChange = { goal_id: second.id, base_version: 1, stages: [stage] };
    await assert.rejects(annual.confirm(owner, { year: 2027, changes: [firstChange, { ...secondChange, base_version: 0 }] }),
      { code: "LIGHTTICK_VERSION_CONFLICT" });
    assert.equal((await roadmaps.get(owner, first.id)).version, 0);

    const otherTitle = "Alternate result";
    const results = await Promise.allSettled([
      annual.confirm(owner, { year: 2027, changes: [firstChange, secondChange] }),
      annual.confirm(owner, { year: 2027, changes: [secondChange, firstChange].map(change => ({
        ...change, stages: [{ ...stage, title: otherTitle }],
      })) }),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.equal(rejected?.reason.code, "LIGHTTICK_VERSION_CONFLICT");
    const firstSaved = await roadmaps.get(owner, first.id);
    const secondSaved = await roadmaps.get(owner, second.id);
    assert.equal(firstSaved.version, 1);
    assert.equal(secondSaved.version, 2);
    assert.equal(firstSaved.stages[0]?.title, secondSaved.stages[0]?.title);
    assert.equal((await repository.listTasks(owner)).length, 0);
    assert.equal((await repository.listPlans(owner)).length, 0);
  } finally {
    await pool.end();
  }
});

test("PostgreSQL agenda applies owner and timezone scope to completed history and learning access", async () => {
  await runPostgresMigrations({ connectionString: databaseUrl, log: () => undefined });
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PostgresLightTickRepository(pool);
  const now = new Date("2027-01-01T00:00:00Z");
  const stamps = { createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const owner = { appId: "lighttick", userId: randomId("agenda_pg") };
  const otherOwner = { ...owner, userId: randomId("agenda_pg") };
  const goals = new LightTickGoalService(repository, () => now);
  const plans = new LightTickPlanService(repository, () => now);
  const writes = new ManualPlanningService(repository, () => now);
  try {
    await repository.saveProfile({ ...owner, ...stamps, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced",
      onboardingState: "completed", notificationPreferences: {}, onboardingDraft: {} });
    const selected = await goals.create(owner, { title: "History goal", constraints: {} });
    const foreign = await goals.create(otherOwner, { title: "Another person's goal", constraints: {} });
    const draft = await plans.createProposed(owner, { goalId: selected.id, source: "ai", granularity: "week",
      periodStart: "2026-12-28", periodEnd: "2027-01-03", tasks: [
        { title: "January in Shanghai", scheduledFor: "2026-12-31T16:05:00Z", estimatedMinutes: 10 },
        { title: "December in Shanghai", scheduledFor: "2026-12-31T15:55:00Z", estimatedMinutes: 10 },
      ] });
    const plan = await plans.confirm(owner, draft.id, draft.version);
    const lessonSource = { route_id: "stopped-route", route_version: 1, lesson_number: 1, lesson_id: "lesson",
      content_version: "a".repeat(64), purpose: "learn" as const };
    for (const task of plan.tasks) {
      await repository.saveTask({ ...task, status: "completed", completedAt: stamps.createdAt, lessonSource },
        writes.write(owner, "task", task.id, task.version + 1, "task_completed", stamps.updatedAt, { status: "completed" }), task.version);
    }
    await repository.savePlan({ ...plan.plan, status: "superseded" },
      writes.write(owner, "plan", plan.plan.id, plan.plan.version + 1, "learning_schedule_stopped", stamps.updatedAt,
        { status: "superseded" }), plan.plan.version);
    const query = { starts_on: "2027-01-01", ends_on: "2027-01-31", goal_id: selected.id, include_completed_history: "true" };
    assert.deepEqual((await readPlanningAgenda(repository, owner, now, query)).items, []);
    await assert.rejects(readPlanningAgenda(repository, owner, now, { ...query, goal_id: foreign.id }),
      { code: "LIGHTTICK_RESOURCE_NOT_FOUND" });
    await repository.saveLearningAuthority({ ...owner, phase: "zook", module: "learning", readingEnabled: true,
      privateEnabled: false, epoch: 1, revision: 1, manifestHash: null, sourceBinding: null, updatedAt: stamps.updatedAt }, 0);
    assert.deepEqual((await readPlanningAgenda(repository, owner, now, query)).items.map(task => task.scheduled_date), ["2027-01-01"]);
    assert.deepEqual((await readPlanningAgenda(repository, owner, now, { ...query, include_completed_history: "false" })).items, []);
  } finally {
    await pool.end();
  }
});

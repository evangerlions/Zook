import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { AnnualPlanningService } from "../../src/modules/lighttick/planning/annual-planning.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
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

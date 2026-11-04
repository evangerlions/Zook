import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, readdir } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { createBodyLogPostgresStores } from "../../src/infrastructure/database/postgres/postgres-bodylog-store-adapters.ts";
import * as growth from "../../src/infrastructure/database/postgres/postgres-bodylog-growth.ts";

const url = process.env.BODYLOG_TEST_DATABASE_URL;
test("BodyLog local goal aggregates survive migration replay and serialize corrections with reward claims", { skip: !url }, async () => {
  const admin = new Pool({ connectionString: url });
  const schema = `bodylog_growth_${Date.now()}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE zook_users (id TEXT PRIMARY KEY)");
    await pool.query("CREATE TABLE zook_bodylog_invitations (id TEXT PRIMARY KEY, app_id TEXT, created_at TIMESTAMPTZ)");
    const dir = new URL("../../src/infrastructure/database/postgres/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(f => /^0(4\d|5[0-7])_/.test(f)).sort())
      await pool.query(await readFile(new URL(file, dir), "utf8"));
    await pool.query("INSERT INTO zook_users VALUES ('alice'), ('bob')");
    const legacy = await pool.query(`INSERT INTO bodylog_seven_day_plans
      (user_id,start_date,end_date,status,completed_missions,total_missions,app_id)
      VALUES ('alice',NOW(),NOW()+INTERVAL '7 days','active',0,21,'bodylog') RETURNING id`);
    const migration = await readFile(new URL("067_bodylog_growth_local_goal_aggregates.sql", dir), "utf8");
    await pool.query(migration);
    assert.equal((await growth.findPostgresGrowthPlanById(pool, legacy.rows[0].id))?.status, "cancelled");
    const plan = await growth.createPostgresGrowthPlan(pool, { userId: "alice", startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-01-08T00:00:00Z", status: "active", completedMissions: 0, totalMissions: 1, timeZone: "UTC" });
    await growth.createPostgresGrowthMission(pool, { planId: plan.id, day: 1, type: "localGoal", target: 1, completed: false });
    const reward = await growth.createPostgresGrowthReward(pool, { planId: plan.id, type: "badge", value: "champion", claimed: false });
    await pool.query(migration);
    assert.equal((await growth.findPostgresGrowthPlanById(pool, plan.id))?.status, "active");

    const session = new AsyncLocalStorage<PoolClient>();
    const query = (sql: string, values?: unknown[]) => (session.getStore() ?? pool).query(sql, values);
    const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await session.run(client, operation);
        await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    };
    const store = createBodyLogPostgresStores(query, execute).growth;
    const input = { userId: "alice", localDate: "2026-01-01", timeZone: "UTC", completedGoalCount: 1,
      eligibleGoalCount: 2, definitionVersion: 1, eventId: "00000000-0000-4000-8000-000000000001" };
    const timestamp = "2026-01-01T12:00:00.000Z";
    const results = await Promise.all(Array.from({ length: 4 }, () => store.applyGrowthDailyAggregate(plan.id, 1, input, true, timestamp)));
    assert.ok(results.every(result => result.aggregate?.localDate === input.localDate));
    assert.equal((await store.findGrowthPlanById(plan.id))?.completedMissions, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM bodylog_growth_daily_aggregates")).rows[0].count, 1);
    await store.applyGrowthDailyAggregate(plan.id, 1, { ...input, completedGoalCount: 0 }, false, timestamp);
    assert.equal((await store.findGrowthPlanById(plan.id))?.status, "active");
    assert.equal((await store.findGrowthMissionsByPlanId(plan.id))[0]?.completedAt, null);
    await assert.rejects(store.applyGrowthDailyAggregate(plan.id, 1, { ...input, userId: "missing" }, true, timestamp));
    assert.equal((await store.findGrowthPlanById(plan.id))?.completedMissions, 0);
    await store.applyGrowthDailyAggregate(plan.id, 1, input, true, timestamp);
    const [claimed, correction] = await Promise.all([
      store.claimGrowthReward!(reward.id, timestamp),
      store.applyGrowthDailyAggregate(plan.id, 1, { ...input, completedGoalCount: 0 }, false, timestamp),
    ]);
    if (claimed) {
      assert.equal(correction.locked, true);
      assert.equal((await store.findGrowthPlanById(plan.id))?.status, "completed");
    } else {
      assert.equal(correction.locked, false);
      assert.equal((await store.findGrowthPlanById(plan.id))?.status, "active");
      await store.applyGrowthDailyAggregate(plan.id, 1, input, true, timestamp);
    }
    const confirmed = await store.claimGrowthReward!(reward.id, timestamp);
    assert.equal(confirmed?.claimed, true);
    assert.deepEqual(await store.claimGrowthReward!(reward.id, timestamp), confirmed);
    assert.equal((await store.applyGrowthDailyAggregate(plan.id, 1, { ...input, completedGoalCount: 0 }, false, timestamp)).locked, true);
    await pool.query(migration);
    assert.equal((await store.findGrowthPlanById(plan.id))?.status, "completed");
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

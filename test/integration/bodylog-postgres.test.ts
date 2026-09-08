import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { createBodyLogPostgresStores } from '../../src/infrastructure/database/postgres/postgres-bodylog-store-adapters.ts';
import * as growth from '../../src/infrastructure/database/postgres/postgres-bodylog-growth.ts';
import * as groups from '../../src/infrastructure/database/postgres/postgres-bodylog-group.ts';

const url = process.env.BODYLOG_TEST_DATABASE_URL;
test('BodyLog migrations replay and concurrent mission completion counts once', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const schema = `bodylog_test_${Date.now()}`;
  const concurrent = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query('CREATE TABLE zook_users (id TEXT PRIMARY KEY)');
    await client.query('CREATE TABLE zook_bodylog_invitations (id TEXT PRIMARY KEY, app_id TEXT, created_at TIMESTAMPTZ)');
    const dir = new URL('../../src/infrastructure/database/postgres/migrations/', import.meta.url);
    const files = (await readdir(dir)).filter(f => /^0(4\d|5[0-7])_/.test(f)).sort();
    for (let replay = 0; replay < 2; replay++) {
      for (const file of files) await client.query(await readFile(new URL(file, dir), 'utf8'));
    }
    await client.query("INSERT INTO zook_users VALUES ('alice')");
    const db = client as unknown as Pool;
    const plan = await growth.createPostgresGrowthPlan(db, { userId: 'alice', startDate: new Date().toISOString(), endDate: new Date(Date.now() + 604800000).toISOString(), status: 'active', completedMissions: 0, totalMissions: 1 });
    const mission = await growth.createPostgresGrowthMission(db, { planId: plan.id, day: 1, type: 'steps', target: 8000, completed: false });
    const results = await Promise.all(Array.from({ length: 5 }, () => growth.completePostgresGrowthMission(concurrent, mission.id, new Date().toISOString())));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await growth.findPostgresGrowthPlanById(db, plan.id))?.completedMissions, 1);
    assert.equal((await growth.findPostgresGrowthPlanById(db, plan.id))?.status, 'completed');
    const now = new Date().toISOString();
    const group = { id: 'group', appId: 'bodylog', name: 'group', icon: null, leaderUserId: 'alice', sharedHabitIds: ['steps'], completionRule: 'all' as const, maxMembers: 3, status: 'active' as const, consecutiveDays: 0, maxConsecutive: 0, currentTier: null, lastActiveDate: null, createdAt: now, updatedAt: now };
    await groups.insertCheckInGroup(db, group);
    await groups.updateCheckInGroup(db, { ...group, leaderUserId: 'bob', lastActiveDate: '2026-09-06' });
    assert.equal((await groups.findCheckInGroup(db, group.id))?.leaderUserId, 'bob');
    assert.equal((await groups.findCheckInGroup(db, group.id))?.lastActiveDate, '2026-09-06');
    const session = new AsyncLocalStorage<PoolClient>();
    const query = (sql: string, values?: unknown[]) => session.getStore()!.query(sql, values);
    const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
      const connection = await concurrent.connect();
      try {
        await connection.query('BEGIN');
        const result = await session.run(connection, operation);
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    };
    const stores = createBodyLogPostgresStores(query, execute);
    await assert.rejects(stores.jobs.runOnce('daily', async () => {
      await stores.group.updateCheckInGroup({ ...group, consecutiveDays: 1 });
      throw new Error('crash');
    }));
    assert.equal((await groups.findCheckInGroup(db, group.id))?.consecutiveDays, 0);
    const settlements = await Promise.all(Array.from({ length: 4 }, () => stores.jobs.runOnce('daily', async () => {
      const current = (await stores.group.findCheckInGroup(group.id))!;
      await stores.group.updateCheckInGroup({ ...current, consecutiveDays: current.consecutiveDays + 1 });
    })));
    assert.equal(settlements.filter(Boolean).length, 1);
    assert.equal((await groups.findCheckInGroup(db, group.id))?.consecutiveDays, 1);
    // Startup replays migrations even after real feature data has been written.
    for (const file of files) await client.query(await readFile(new URL(file, dir), 'utf8'));
    assert.equal((await growth.findPostgresGrowthPlanById(db, plan.id))?.completedMissions, 1);
    assert.equal((await growth.findPostgresGrowthPlanById(db, plan.id))?.status, 'completed');
    assert.equal((await groups.findCheckInGroup(db, group.id))?.consecutiveDays, 1);
  } finally {
    await concurrent.end();
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});

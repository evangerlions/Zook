import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { FrogSleepFocusBuddyService } from "../../src/modules/frogsleep/focus-buddy/focus-buddy.service.ts";
import { buildFocusSessionReport } from "../../src/modules/frogsleep/focus-buddy/focus-session-report.ts";

const databaseUrl = process.env.FROGSLEEP_TEST_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("FROGSLEEP_TEST_DATABASE_URL must point to a disposable PostgreSQL database.");
const migrationPath = new URL("../../src/infrastructure/database/postgres/migrations/021_frogsleep_focus_session_idempotency.sql", import.meta.url);
const indexName = "idx_frogsleep_focus_sessions_client_uidx";
function payload(id = "phase2a-pg-focus", minutes = 25) {
  return { session_id: id, goal_tag: "study", planned_minutes: 25, actual_minutes: minutes,
    status: "completed", started_at: "2026-10-10T10:00:00Z", ended_at: "2026-10-10T10:25:00Z" };
}
async function clean(sql: Client) {
  await sql.query("DELETE FROM zook_frogsleep_focus_shared_moments WHERE id LIKE 'phase2a-pg-%'");
  await sql.query("DELETE FROM zook_frogsleep_focus_sessions WHERE payload->>'client_session_id' LIKE 'phase2a-pg-%' OR id LIKE 'phase2a-pg-%'");
}
async function stats(service: FrogSleepFocusBuddyService, user: string, minutes: number) {
  const list = await service.sessions(user); const week = await service.weekStats(user, "2026-10-05");
  assert.equal(list.sessions.length, 1); assert.equal(week.session_count, 1);
  assert.equal(week.total_minutes, minutes); assert.equal(week.completed_count, 1);
  assert.equal(week.daily.reduce((sum, day) => sum + day.session_count, 0), 1);
  assert.equal(week.daily.reduce((sum, day) => sum + day.minutes, 0), minutes);
}
async function apply(sql: Client, text: string, fail = false) {
  await sql.query("BEGIN");
  try {
    await sql.query(text);
    if (fail) throw new Error("fixture rollback");
    await sql.query("COMMIT");
  } catch (error) { await sql.query("ROLLBACK"); throw error; }
}

test("live PostgreSQL private focus idempotency and migration gate", async suite => {
  const sql = new Client({ connectionString: databaseUrl }); await sql.connect();
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const first = await PostgresDatabase.create(databaseUrl!, seed);
  const second = await PostgresDatabase.create(databaseUrl!, seed);
  const a = new FrogSleepFocusBuddyService(first), b = new FrogSleepFocusBuddyService(second);
  const migration = await readFile(migrationPath, "utf8");
  try {
    for (const userId of ["user_alice", "user_bob"]) await first.insertAppUser({ id: `idempotency-${userId}`, appId: "frogsleep", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await suite.test("replay across separate pools preserves server identity and statistics", async () => {
      await clean(sql);
      const original = await a.reportSession("user_alice", payload());
      const replay = await b.reportSession("user_alice", payload());
      assert.deepEqual(replay, original);
      await stats(a, "user_alice", 25);
    });

    await suite.test("real concurrent writers block on the unique key and insert only once", async () => {
      await clean(sql);
      const blocker = new Client({ connectionString: databaseUrl }); await blocker.connect();
      await blocker.query("BEGIN");
      const candidate = buildFocusSessionReport("user_alice", payload());
      await blocker.query(`INSERT INTO zook_frogsleep_focus_sessions
        (id,app_id,owner_user_id,status,starts_at,ends_at,payload,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [candidate.id, candidate.appId, candidate.ownerUserId,
        candidate.status, candidate.startsAt, candidate.endsAt, JSON.stringify(candidate.payload), candidate.createdAt, candidate.updatedAt]);
      const waiting = Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? a : b).reportSession("user_alice", payload())));
      try { await waitForWriter(sql); await blocker.query("COMMIT"); }
      finally { await blocker.query("ROLLBACK"); await blocker.end(); }
      const results = await waiting;
      assert.equal(new Set(results.map(item => item.session_id)).size, 1);
      assert.equal(results[0].session_id, candidate.id);
      await stats(a, "user_alice", 25);
    });

    await suite.test("concurrent cold inserts and corrections do not duplicate rows or totals", async () => {
      await clean(sql);
      const initial = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).reportSession("user_alice", payload())));
      assert.equal(new Set(initial.map(item => item.session_id)).size, 1);
      const corrected = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).reportSession("user_alice", payload("phase2a-pg-focus", 35))));
      assert.ok(corrected.every(item => item.session_id === initial[0].session_id && item.created_at === initial[0].created_at));
      await stats(a, "user_alice", 35);
    });

    await suite.test("mixed concurrent corrections count the final row once", async () => {
      await clean(sql);
      const original = await a.reportSession("user_alice", payload());
      const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? a : b).reportSession("user_alice", payload("phase2a-pg-focus", index % 2 ? 30 : 40))));
      assert.ok(responses.every(item => item.session_id === original.session_id && item.created_at === original.created_at));
      const final = (await a.sessions("user_alice")).sessions[0];
      assert.ok(final.minutes === 30 || final.minutes === 40);
      await stats(a, "user_alice", Number(final.minutes));
    });

    await suite.test("same client ID for A/B and a second app occupies independent keys", async () => {
      await clean(sql);
      const [alice, bob] = await Promise.all([a.reportSession("user_alice", payload()), b.reportSession("user_bob", payload("phase2a-pg-focus", 40))]);
      assert.notEqual(alice.session_id, bob.session_id);
      const otherApp = buildFocusSessionReport("user_alice", payload()); otherApp.appId = "ai_novel";
      const other = await second.upsertFrogSleepFocusSession(otherApp);
      assert.notEqual(other.record.id, alice.session_id);
      await stats(a, "user_alice", 25); await stats(b, "user_bob", 40);
      assert.equal((await sql.query("SELECT COUNT(*)::int AS count FROM zook_frogsleep_focus_sessions WHERE payload->>'client_session_id'=$1", ["phase2a-pg-focus"])).rows[0].count, 3);
    });

    await suite.test("database constraint rejects bypass inserts while missing IDs remain legacy records", async () => {
      await clean(sql);
      await a.reportSession("user_alice", payload());
      await assert.rejects(first.insertFrogSleepEntity(buildFocusSessionReport("user_alice", payload())), { code: "23505" });
      for (const id of ["phase2a-pg-legacy-1", "phase2a-pg-legacy-2"]) {
        const record = buildFocusSessionReport("user_alice", {}); record.id = id;
        await first.insertFrogSleepEntity(record);
      }
      const legacy = await sql.query("SELECT COUNT(*)::int AS count FROM zook_frogsleep_focus_sessions WHERE id LIKE 'phase2a-pg-legacy-%'");
      assert.equal(legacy.rows[0].count, 2);
    });

    await suite.test("confirming an existing result blocks corrections even when binding is omitted", async () => {
      await clean(sql);
      await a.reportSession("user_alice", payload());
      await b.reportSession("user_alice", { ...payload(), binding: { owner_user_id: "user_alice", job_id: "pg-confirm", confirmed_at: "2026-10-16T00:00:00Z" } });
      await assert.rejects(a.reportSession("user_alice", payload("phase2a-pg-focus", 10)), { code: "REQ_INVALID_BODY" });
      await stats(a, "user_alice", 25);
    });

    await suite.test("upgrade rollback, consolidation, reference repair and rerun preserve history", async () => {
      await clean(sql); await sql.query(`DROP INDEX ${indexName}`);
      await seedDuplicateHistory(first);
      await assert.rejects(apply(sql, migration, true), /fixture rollback/);
      assert.equal((await sql.query("SELECT COUNT(*)::int AS count FROM zook_frogsleep_focus_sessions WHERE deleted_at IS NULL AND owner_user_id='user_alice'")).rows[0].count, 2);
      assert.equal((await sql.query("SELECT to_regclass($1) AS name", [indexName])).rows[0].name, null);
      await apply(sql, migration);
      const kept = await first.findFrogSleepEntity("focus_session", "frogsleep", "phase2a-pg-original");
      const duplicate = await first.findFrogSleepEntity("focus_session", "frogsleep", "phase2a-pg-duplicate");
      assert.equal(kept?.payload.minutes, 35); assert.equal(kept?.createdAt, "2026-10-09T00:00:00.000Z");
      assert.ok(duplicate?.deletedAt);
      const moment = await first.findFrogSleepEntity("focus_shared_moment", "frogsleep", "phase2a-pg-moment");
      assert.equal(moment?.payload.session_id, kept?.id); assert.equal(moment?.payload.buddy_session_id, kept?.id);
      await stats(a, "user_alice", 35); await stats(b, "user_bob", 40);
      const before = await sql.query("SELECT id,deleted_at,payload FROM zook_frogsleep_focus_sessions ORDER BY id");
      await apply(sql, migration);
      assert.deepEqual((await sql.query("SELECT id,deleted_at,payload FROM zook_frogsleep_focus_sessions ORDER BY id")).rows, before.rows);
      const replay = await a.reportSession("user_alice", payload("phase2a-pg-upgrade", 35));
      assert.equal(replay.session_id, kept?.id);
      await stats(a, "user_alice", 35);
    });
  } finally { await clean(sql); await Promise.all([first.close(), second.close(), sql.end()]); }
});

async function waitForWriter(sql: Client) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await sql.query(`SELECT COUNT(*)::int AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO zook_frogsleep_focus_sessions AS existing%'`);
    if (rows.rows[0].count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Expected real PostgreSQL unique-key lock contention.");
}

async function seedDuplicateHistory(database: PostgresDatabase) {
  const original = buildFocusSessionReport("user_alice", payload("phase2a-pg-upgrade"));
  original.id = "phase2a-pg-original"; original.createdAt = "2026-10-09T00:00:00Z"; original.updatedAt = original.createdAt;
  const duplicate = buildFocusSessionReport("user_alice", payload("phase2a-pg-upgrade", 35));
  duplicate.id = "phase2a-pg-duplicate"; duplicate.createdAt = "2026-10-10T00:00:00Z"; duplicate.updatedAt = duplicate.createdAt;
  const bob = buildFocusSessionReport("user_bob", payload("phase2a-pg-upgrade", 40));
  await database.insertFrogSleepEntity(original); await database.insertFrogSleepEntity(duplicate); await database.insertFrogSleepEntity(bob);
  await database.insertFrogSleepEntity({ id: "phase2a-pg-moment", appId: "frogsleep", kind: "focus_shared_moment",
    ownerUserId: "user_alice", partnerUserId: "user_bob", payload: { session_id: duplicate.id, buddy_session_id: duplicate.id },
    createdAt: original.createdAt, updatedAt: original.createdAt });
}

// Real PostgreSQL admission regressions. The dedicated runner creates a fresh
// loopback-only cluster; this suite refuses ordinary DATABASE_URL connections.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";
import { activateGroupMember } from "../../src/infrastructure/database/postgres/postgres-bodylog-group-admission.ts";
import type { GroupMemberRecord } from "../../src/modules/bodylog/bodylog-group.types.ts";

const databaseUrl = process.env.BODYLOG_GROUP_TEST_DATABASE_URL;
const directory = process.env.BODYLOG_GROUP_TEST_DIRECTORY;
if (!databaseUrl || !directory) throw new Error("Use test/support/run_bodylog_group_postgres.py to create a disposable cluster.");
const url = new URL(databaseUrl);
const marker = JSON.parse(await readFile(path.join(directory, "cluster.json"), "utf8"));
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "bodylog_group_qa");
assert.equal(url.pathname, "/bodylog_group_qa");
assert.equal(Number(url.port), marker.port);
assert.equal(marker.purpose, "bodylog-group-admission-synthetic-only");
const pool = new Pool({ connectionString: databaseUrl, max: 10, statement_timeout: 5000 });

before(async () => {
  const migration = new URL("../../src/infrastructure/database/postgres/migrations/042_bodylog_groups.sql", import.meta.url);
  await pool.query(await readFile(migration, "utf8"));
  await pool.query("ALTER TABLE zook_bodylog_groups ADD COLUMN IF NOT EXISTS invitation_token TEXT");
});
beforeEach(async () => { await pool.query("TRUNCATE zook_bodylog_groups CASCADE"); });
after(async () => { await pool.end(); });

async function group(id: string, maxMembers = 2) {
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO zook_bodylog_groups
    (id,app_id,name,leader_user_id,max_members,created_at,updated_at,invitation_token)
    VALUES($1,'bodylog','Synthetic group','owner',$2,$3,$3,$4)`, [id, maxMembers, now, `${id}-shared-token`]);
  await pool.query(`INSERT INTO zook_bodylog_group_members(id,group_id,user_id,role,joined_at,status)
    VALUES($1,$2,'owner','leader',$3,'active')`, [`${id}-owner`, id, now]);
}

async function pending(groupId: string, userId: string, token = `${groupId}-${userId}-token`): Promise<GroupMemberRecord> {
  const record: GroupMemberRecord = {
    id: `${groupId}-${userId}`, groupId, userId, role: "member",
    joinedAt: new Date().toISOString(), invitationToken: token, status: "pending",
  };
  await pool.query(`INSERT INTO zook_bodylog_group_members(id,group_id,user_id,role,joined_at,invitation_token,status)
    VALUES($1,$2,$3,$4,$5,$6,'pending')`, [record.id, groupId, userId, record.role, record.joinedAt, token]);
  return record;
}

async function countActive(groupId?: string, userId?: string): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM zook_bodylog_group_members
    WHERE status='active' AND ($1::text IS NULL OR group_id=$1) AND ($2::text IS NULL OR user_id=$2)`,
  [groupId ?? null, userId ?? null]);
  return result.rows[0].n;
}

// Establish overlapping transactions instead of relying on timing luck. One
// contender may wait on a user lock while another waits on the blocked group.
async function waitForTwoAdmissionWaiters() {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
      AND (query LIKE '%pg_advisory_xact_lock%' OR query LIKE '%zook_bodylog_groups%FOR UPDATE%')`);
    if (result.rows[0].n >= 2) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Admission transactions did not overlap at the expected locks.");
}

async function raceAtGroup(groupId: string, records: GroupMemberRecord[], limit: number) {
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM zook_bodylog_groups WHERE id=$1 FOR UPDATE", [groupId]);
  const attempts = records.map(record => activateGroupMember(pool, { ...record, status: "active" }, record.invitationToken!, limit));
  try { await waitForTwoAdmissionWaiters(); }
  finally { await blocker.query("COMMIT"); blocker.release(); }
  return await Promise.all(attempts);
}

test("real PostgreSQL: two recipients cannot both claim the last slot", async () => {
  await group("slot");
  const records = await Promise.all([pending("slot", "bob"), pending("slot", "charlie")]);
  assert.deepEqual((await raceAtGroup("slot", records, 5)).sort(), ["full", "joined"]);
  assert.equal(await countActive("slot"), 2);
});

test("real PostgreSQL: simultaneous acceptance by one recipient creates one membership", async () => {
  await group("duplicate");
  const record = await pending("duplicate", "bob");
  assert.deepEqual((await raceAtGroup("duplicate", [record, record], 5)).sort(), ["alreadyMember", "joined"]);
  assert.equal(await countActive("duplicate", "bob"), 1);
  assert.equal(await countActive("duplicate"), 2);
});

test("real PostgreSQL: one user's concurrent joins cannot exceed the cross-group quota", async () => {
  await Promise.all([group("quota-a"), group("quota-b")]);
  const records = await Promise.all([pending("quota-a", "bob"), pending("quota-b", "bob")]);
  const blocker = await pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["bodylog-group-user:bob"]);
  const attempts = records.map(record => activateGroupMember(pool, { ...record, status: "active" }, record.invitationToken!, 1));
  try { await waitForTwoAdmissionWaiters(); }
  finally { await blocker.query("COMMIT"); blocker.release(); }
  assert.deepEqual((await Promise.all(attempts)).sort(), ["joined", "limit"]);
  assert.equal(await countActive(undefined, "bob"), 1);
});

test("real PostgreSQL: a renewed invitation rejects its earlier token", async () => {
  await group("renewal");
  const record = await pending("renewal", "bob", "earlier-token");
  await pool.query("UPDATE zook_bodylog_group_members SET invitation_token='renewed-token' WHERE id=$1", [record.id]);
  assert.equal(await activateGroupMember(pool, { ...record, status: "active" }, "earlier-token", 5), "invalid");
  assert.equal(await countActive("renewal", "bob"), 0);
  assert.equal(await activateGroupMember(pool, { ...record, invitationToken: "renewed-token", status: "active" }, "renewed-token", 5), "joined");
});

test("real PostgreSQL: archived groups and removed members reject activation", async () => {
  await Promise.all([group("archived"), group("removed")]);
  const archived = await pending("archived", "bob");
  const removed = await pending("removed", "charlie");
  await pool.query("UPDATE zook_bodylog_groups SET status='archived' WHERE id='archived'");
  await pool.query("UPDATE zook_bodylog_group_members SET status='removed' WHERE id=$1", [removed.id]);
  assert.equal(await activateGroupMember(pool, { ...archived, status: "active" }, archived.invitationToken!, 5), "invalid");
  assert.equal(await activateGroupMember(pool, { ...removed, status: "active" }, removed.invitationToken!, 5), "invalid");
  assert.equal(await countActive(undefined, "bob"), 0);
  assert.equal(await countActive(undefined, "charlie"), 0);
});

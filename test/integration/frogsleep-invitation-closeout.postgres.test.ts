import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { BuddyDomainInvitationCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-command.service.ts";
import { BuddyDomainInvitationSafetyCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-safety-command.service.ts";
import { BuddyInvitationBundleService } from "../../src/modules/frogsleep/buddy-growth/buddy-invitation-bundle.service.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must refer to a disposable database.");
const now = () => new Date().toISOString();
const input = (key: string) => ({ expectedVersion: 1, idempotencyKey: key });
async function seed(database: PostgresDatabase, id: string, bound = true) {
  const createdAt = now();
  await database.upsertFrogSleepBuddyInvitationBundle({ appId: "frogsleep", id, inviterUserId: "user_alice",
    inviteeUserId: bound ? "user_bob" : undefined, recipientEmail: "future@example.com", shareCode: id.toUpperCase(), handoffToken: id,
    shareLink: `https://example.com/invite?token=${id}`, locale: "zh-CN", status: "pending",
    domains: ["sleep", "focus"], version: 1, domainInvitationIds: {}, domainErrorCodes: {},
    expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt, updatedAt: createdAt });
  for (const domain of ["sleep", "focus"] as const) await database.upsertFrogSleepBuddyInvitationDomainDecision({
    appId: "frogsleep", invitationId: id, domain, status: "pending", version: 1, createdAt, updatedAt: createdAt });
}
async function reset(sql: Client) {
  await sql.query("DELETE FROM zook_frogsleep_buddy_sharing_grants");
  for (const suffix of ["sleep_relationships", "focus_relationships", "sleep_invites", "focus_invites"]) {
    await sql.query(`DELETE FROM zook_frogsleep_${suffix}`);
  }
  await sql.query("DELETE FROM zook_frogsleep_buddy_domain_slots");
  await sql.query("DELETE FROM zook_frogsleep_buddy_domain_relationships");
  await sql.query("DELETE FROM zook_frogsleep_buddy_invitation_domain_decisions");
  await sql.query("DELETE FROM zook_frogsleep_buddy_invitation_bundles");
  await sql.query("DELETE FROM zook_frogsleep_buddy_notification_outbox");
}
async function outboxCount(sql: Client, id: string) {
  const result = await sql.query("SELECT count(*)::int AS count FROM zook_frogsleep_buddy_notification_outbox WHERE target_id=$1", [id]);
  return result.rows[0].count;
}

test("live PostgreSQL invitation continuation, decisions and original relationship receipts", async suite => {
  const sql = new Client({ connectionString: url }); await sql.connect();
  const defaultSeed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const first = await PostgresDatabase.create(url, defaultSeed);
  const second = await PostgresDatabase.create(url, defaultSeed);
  const acceptA = new BuddyDomainInvitationCommandService(first);
  const acceptB = new BuddyDomainInvitationCommandService(second);
  const safety = new BuddyDomainInvitationSafetyCommandService(second);
  try {
    await suite.test("two connections with the same accept key retain one decision, relationship and event", async () => {
      await reset(sql); await seed(first, "closeout_repeat");
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? acceptA : acceptB)
        .accept("user_bob", "closeout_repeat", "sleep", input("repeat"))));
      assert.equal(new Set(results.map(r => r.relationship_id)).size, 1);
      assert.equal(await outboxCount(sql, "closeout_repeat"), 1);
      assert.equal((await first.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "closeout_repeat", "focus"))?.version, 1);
      assert.equal((await sql.query("SELECT count(*)::int AS count FROM zook_frogsleep_buddy_domain_relationships")).rows[0].count, 1);
    });
    await suite.test("accept against cancel has one winner and no loser writes across connections", async () => {
      for (let i = 0; i < 8; i++) {
        await reset(sql); const id = `closeout_race_${i}`; await seed(first, id);
        const commands = [() => acceptA.accept("user_bob", id, "sleep", input("accept")),
          () => safety.execute("user_alice", id, "sleep", "cancel", input("cancel"))];
        const outcomes = await Promise.allSettled((i % 2 ? commands.reverse() : commands).map(fn => fn()));
        assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
        const rejected = outcomes.find(r => r.status === "rejected") as PromiseRejectedResult;
        assert.equal(rejected.reason.statusCode, 409);
        const decision = await first.findFrogSleepBuddyInvitationDomainDecision("frogsleep", id, "sleep");
        assert.equal(decision?.version, 2); assert.equal(await outboxCount(sql, id), 1);
        const count = (await sql.query("SELECT count(*)::int AS count FROM zook_frogsleep_buddy_domain_relationships")).rows[0].count;
        assert.equal(count, decision?.status === "accepted" ? 1 : 0);
      }
    });
    await suite.test("distinct domain decisions progress independently and survive a new database connection", async () => {
      await reset(sql); await seed(first, "closeout_domains");
      const results = await Promise.all([acceptA.accept("user_bob", "closeout_domains", "sleep", input("sleep")),
        safety.execute("user_bob", "closeout_domains", "focus", "decline", input("focus"))]);
      assert.deepEqual(results.map(r => r.decision_status), ["accepted", "declined"]);
      const preview = await new BuddyInvitationBundleService(second).preview("user_bob", "closeout_domains");
      assert.deepEqual(preview.domain_results.map(r => [r.status, r.decision_version]), [["accepted", 2], ["declined", 2]]);
      assert.equal((await acceptB.accept("user_bob", "closeout_domains", "sleep", input("sleep"))).relationship_id, results[0].relationship_id);
      assert.equal(await outboxCount(sql, "closeout_domains"), 2);
    });
    await suite.test("unbound email requires the correct account and binds only with the successful decision", async () => {
      await reset(sql); await seed(first, "closeout_claim", false);
      await assert.rejects(acceptA.accept("user_bob", "closeout_claim", "sleep", input("wrong")), { statusCode: 404 });
      assert.equal((await first.findFrogSleepBuddyInvitationBundle("frogsleep", "closeout_claim"))?.inviteeUserId, undefined);
      await first.updateUserEmail("user_bob", "future@example.com");
      try {
        await acceptA.accept("user_bob", "closeout_claim", "sleep", input("right"));
        assert.equal((await second.findFrogSleepBuddyInvitationBundle("frogsleep", "closeout_claim"))?.inviteeUserId, "user_bob");
      } finally { await first.updateUserEmail("user_bob", "bob@example.com"); }
    });
    await suite.test("receipt replay after release and new slot occupation returns the original revoked relationship", async () => {
      await reset(sql); await seed(first, "closeout_receipt");
      const accepted = await acceptA.accept("user_bob", "closeout_receipt", "focus", input("receipt"));
      const original = await first.findFrogSleepBuddyDomainRelationship("frogsleep", accepted.relationship_id);
      await first.compareAndUpdateFrogSleepBuddyDomainRelationship({ appId: "frogsleep", id: original!.id,
        expectedVersion: 1, status: "revoked", pausedByUserIds: [], revokedAt: now(), updatedAt: now() });
      await sql.query("UPDATE zook_frogsleep_buddy_domain_slots SET state='available', relationship_id=NULL, version=version+1");
      await seed(first, "closeout_new_relation");
      const next = await acceptB.accept("user_bob", "closeout_new_relation", "focus", input("new"));
      assert.notEqual(next.relationship_id, accepted.relationship_id);
      const replay = await acceptB.accept("user_bob", "closeout_receipt", "focus", input("receipt"));
      assert.equal(replay.relationship_id, accepted.relationship_id); assert.equal(replay.relationship_status, "revoked");
      await assert.rejects(acceptA.accept("user_bob", "closeout_receipt", "focus", { ...input("receipt"), expectedVersion: 2 }), { statusCode: 409 });
      assert.equal(await outboxCount(sql, "closeout_receipt"), 1);
    });
    await suite.test("compatibility aggregate and domain commands serialize without deadlocks or duplicate domain facts", async () => {
      for (const action of ["accept", "cancel"] as const) {
        await reset(sql);
        await sql.query("DELETE FROM zook_frogsleep_buddy_sharing_grants");
        for (const suffix of ["sleep_relationships", "focus_relationships", "sleep_invites", "focus_invites"]) {
          await sql.query(`DELETE FROM zook_frogsleep_${suffix}`);
        }
        const legacy = new BuddyInvitationBundleService(first);
        const created = await legacy.create({ inviterUserId: "user_alice", target: "user_bob", domains: ["sleep", "focus"],
          sleepInviteBaseUrl: "frogsleep://sleep-buddy-invite", focusInviteBaseUrl: "frogsleep://focus-invite", handoffBaseUrl: "https://example.com/invite" });
        const id = created.invitation_id;
        const other = action === "accept" ? acceptB.accept("user_bob", id, "sleep", input("domain"))
          : safety.execute("user_alice", id, "sleep", "cancel", input("domain"));
        const results = await Promise.allSettled([legacy.respond("user_bob", id, "accept", input("legacy")), other]);
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
        const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
        assert.equal(rejected.reason.statusCode, 409);
        const preview = await new BuddyInvitationBundleService(second).preview("user_bob", id);
        assert.notEqual(preview.domain_results[0].status, "pending");
        assert.equal((await first.findFrogSleepBuddyInvitationDomainDecision("frogsleep", id, "sleep"))?.version, 2);
      }
    });
    await suite.test("different compatibility and canonical invitations cannot occupy the same Sleep user twice", async () => {
      for (let i = 0; i < 4; i++) {
        await reset(sql);
        for (const suffix of ["sleep_relationships", "focus_relationships", "sleep_invites", "focus_invites"]) {
          await sql.query(`DELETE FROM zook_frogsleep_${suffix}`);
        }
        const legacy = new BuddyInvitationBundleService(first);
        const created = await legacy.create({ inviterUserId: "user_alice", target: "user_bob", domains: ["sleep"],
          sleepInviteBaseUrl: "frogsleep://sleep-buddy-invite", focusInviteBaseUrl: "frogsleep://focus-invite", handoffBaseUrl: "https://example.com/invite" });
        await seed(first, `closeout_alternative_${i}`);
        const commands = [() => legacy.respond("user_bob", created.invitation_id, "accept", input("legacy")),
          () => acceptB.accept("user_bob", `closeout_alternative_${i}`, "sleep", input("canonical"))];
        await Promise.allSettled((i % 2 ? commands.reverse() : commands).map(fn => fn()));
        const current = await sql.query(`SELECT (
          (SELECT count(*) FROM zook_frogsleep_buddy_domain_relationships WHERE domain='sleep' AND status='active') +
          (SELECT count(*) FROM zook_frogsleep_sleep_relationships WHERE status='active' AND deleted_at IS NULL))::int AS count`);
        assert.equal(current.rows[0].count, 1);
      }
    });
    await suite.test("concurrent safety replay creates one event and no slots", async () => {
      await reset(sql); await seed(first, "closeout_safety");
      const other = new BuddyDomainInvitationSafetyCommandService(first);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? safety : other)
        .execute("user_alice", "closeout_safety", "sleep", "cancel", input("cancel"))));
      assert.equal(results.every(r => r.decision_version === 2), true);
      assert.equal(await outboxCount(sql, "closeout_safety"), 1);
      assert.equal((await sql.query("SELECT count(*)::int AS count FROM zook_frogsleep_buddy_domain_slots")).rows[0].count, 0);
    });
    await suite.test("migration recovers only the exact original relationship and is repeatable", async () => {
      await reset(sql); await seed(first, "closeout_upgrade");
      const accepted = await acceptA.accept("user_bob", "closeout_upgrade", "focus", input("upgrade"));
      await sql.query("UPDATE zook_frogsleep_buddy_invitation_domain_decisions SET relationship_id=NULL WHERE invitation_id='closeout_upgrade'");
      const migration = await readFile(new URL("../../src/infrastructure/database/postgres/migrations/022_frogsleep_invitation_relationship_receipt.sql", import.meta.url), "utf8");
      await sql.query(migration); await sql.query(migration);
      const decision = await first.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "closeout_upgrade", "focus");
      assert.equal(decision?.relationshipId, accepted.relationship_id);
      assert.equal((await acceptB.accept("user_bob", "closeout_upgrade", "focus", input("upgrade"))).relationship_id, accepted.relationship_id);
    });
  } finally { await reset(sql); await Promise.all([first.close(), second.close(), sql.end()]); }
});

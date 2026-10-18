import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import { BuddyRelationshipLifecycleService } from "../../src/modules/frogsleep/buddy-growth/buddy-relationship-lifecycle.service.ts";
import { BuddyDomainInvitationCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-command.service.ts";
import { recordBuddyBlock, revokeBuddyBlock } from "../../src/modules/frogsleep/buddy-growth/buddy-safety.ts";

const url = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!url) throw new Error("FROGSLEEP_TEST_DATABASE_URL must refer to a disposable database.");
const now = () => new Date().toISOString();
const zero = { presence: 0, daily_summary: 0, weekly_trend: 0, shared_activity: 0 };
const keys = (domain: "sleep" | "focus" = "sleep") => ["user_alice", "user_bob"].map(userId => ({ appId: "frogsleep", userId, domain }));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function within<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PostgreSQL lock test timed out")), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function seed(database: PostgresDatabase, id: string, domain: "sleep" | "focus" = "sleep") {
  const timestamp = now();
  await database.insertFrogSleepBuddyDomainRelationship({ id, appId: "frogsleep", domain, userIdLow: "user_alice", userIdHigh: "user_bob",
    status: "active", pausedByUserIds: [], version: 1, createdAt: timestamp, updatedAt: timestamp });
  for (const key of keys(domain)) {
    const slot = await database.ensureFrogSleepBuddyDomainSlot({ ...key, now: timestamp });
    await database.compareAndUpdateFrogSleepBuddyDomainSlot({ ...key, expectedVersion: slot.version,
      state: "occupied", relationshipId: id, updatedAt: timestamp });
  }
}

test("live PostgreSQL direction grants, lifecycle concurrency, rollback and slot cleanup", async suite => {
  const defaultSeed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const first = await PostgresDatabase.create(url, defaultSeed); const second = await PostgresDatabase.create(url, defaultSeed);
  const sql = new Client({ connectionString: url }); await sql.connect();
  const lifeA = new BuddyRelationshipLifecycleService(first), lifeB = new BuddyRelationshipLifecycleService(second);
  const consentA = new BuddyConsentService(first), consentB = new BuddyConsentService(second);
  try {
    await suite.test("concurrent own-direction grants have one version winner and never affect the partner direction", async () => {
      await seed(first, "pg_consent");
      const outcomes = await Promise.allSettled([consentA.replaceOwn("user_alice", "pg_consent", "sleep", ["presence"], zero),
        consentB.replaceOwn("user_alice", "pg_consent", "sleep", ["daily_summary"], zero)]);
      assert.equal(outcomes.filter(row => row.status === "fulfilled").length, 1);
      assert.equal((outcomes.find(row => row.status === "rejected") as PromiseRejectedResult).reason.statusCode, 409);
      const grants = await first.listFrogSleepBuddySharingGrants("frogsleep", "pg_consent");
      assert.equal(grants.length, 1); assert.equal(grants[0].grantorUserId, "user_alice"); assert.equal(grants[0].version, 1);
      await lifeA.execute("user_alice", "pg_consent", "revoke", 1);
    });
    await suite.test("a pause holding participant locks prevents a late grant from committing across connections", async () => {
      await seed(first, "pg_pause_gate"); const held = deferred(), release = deferred();
      const pausing = first.withFrogSleepBuddyCommandTransaction(keys(), async () => {
        await lifeA.execute("user_bob", "pg_pause_gate", "pause", 1); held.resolve(); await release.promise;
      });
      await within(held.promise); let finished = false;
      const granting = consentB.replaceOwn("user_alice", "pg_pause_gate", "sleep", ["presence"], zero)
        .then(value => ({ value }), error => ({ error })).finally(() => { finished = true; });
      await new Promise(done => setTimeout(done, 40)); assert.equal(finished, false); release.resolve();
      await within(pausing); const result = await within(granting); assert.equal((result as any).error.statusCode, 404);
      assert.equal((await first.listFrogSleepBuddySharingGrants("frogsleep", "pg_pause_gate")).length, 0);
      await lifeA.execute("user_alice", "pg_pause_gate", "revoke", 2);
    });
    await suite.test("audit failure rolls back the entire multi-category grant batch", async () => {
      await seed(first, "pg_atomic_grants"); const audit = first.insertAuditLog.bind(first); let count = 0;
      first.insertAuditLog = async record => { if (++count === 2) throw new Error("injected audit failure"); return await audit(record); };
      try { await assert.rejects(consentA.replaceOwn("user_alice", "pg_atomic_grants", "sleep", ["presence", "daily_summary"], zero), /injected audit failure/); }
      finally { first.insertAuditLog = audit; }
      assert.equal((await second.listFrogSleepBuddySharingGrants("frogsleep", "pg_atomic_grants")).length, 0);
      await lifeA.execute("user_alice", "pg_atomic_grants", "revoke", 1);
    });
    await suite.test("both actors pause and only their own resume is removed after reconnection", async () => {
      await seed(first, "pg_dual_pause"); await lifeA.execute("user_alice", "pg_dual_pause", "pause", 1);
      await lifeB.execute("user_bob", "pg_dual_pause", "pause", 2); await lifeA.execute("user_alice", "pg_dual_pause", "resume", 3);
      assert.deepEqual((await lifeB.detail("user_bob", "pg_dual_pause")).paused_by_user_ids, ["user_bob"]);
      assert.equal((await lifeB.execute("user_bob", "pg_dual_pause", "resume", 4)).status, "active");
      await lifeA.execute("user_alice", "pg_dual_pause", "revoke", 5);
    });
    await suite.test("revoke racing a grant leaves both directions inaccessible regardless of winner", async () => {
      await seed(first, "pg_revoke_gate");
      await Promise.allSettled([consentA.replaceOwn("user_alice", "pg_revoke_gate", "sleep", ["shared_activity"], zero),
        lifeB.execute("user_bob", "pg_revoke_gate", "revoke", 1)]);
      assert.equal((await lifeA.detail("user_alice", "pg_revoke_gate")).status, "revoked");
      assert.ok((await first.listFrogSleepBuddySharingGrants("frogsleep", "pg_revoke_gate")).every(g => g.state === "revoked"));
      await assert.rejects(consentB.assertAuthorized("user_bob", "pg_revoke_gate", "shared_activity"), { statusCode: 404 });
    });
    await suite.test("old revoke replay cannot release slots allocated by a later real invitation acceptance", async () => {
      await seed(first, "pg_old_relationship"); await lifeA.execute("user_alice", "pg_old_relationship", "revoke", 1);
      const timestamp = now();
      await first.upsertFrogSleepBuddyInvitationBundle({ id: "pg_new_invite", appId: "frogsleep", inviterUserId: "user_alice",
        inviteeUserId: "user_bob", shareCode: "LIFECYCLE-PG", handoffToken: "lifecycle-pg-token",
        shareLink: "https://example.com/invite", locale: "zh-CN", domains: ["sleep"], status: "pending", version: 1, domainInvitationIds: {}, domainErrorCodes: {},
        expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: timestamp, updatedAt: timestamp });
      await first.upsertFrogSleepBuddyInvitationDomainDecision({ appId: "frogsleep", invitationId: "pg_new_invite", domain: "sleep",
        status: "pending", version: 1, createdAt: timestamp, updatedAt: timestamp });
      const accepted = await new BuddyDomainInvitationCommandService(second).accept("user_bob", "pg_new_invite", "sleep", { expectedVersion: 1, idempotencyKey: "new" });
      await lifeA.execute("user_bob", "pg_old_relationship", "revoke", 1);
      assert.equal((await first.findFrogSleepBuddyDomainSlot("frogsleep", "user_alice", "sleep"))?.relationshipId, accepted.relationship_id);
      await lifeB.execute("user_bob", accepted.relationship_id, "revoke", 1);
    });
    await suite.test("block releases both domains and persists revoked grants and sessions across independent connections", async () => {
      await seed(first, "pg_block_sleep"); await seed(first, "pg_block_focus", "focus");
      await consentA.replaceOwn("user_alice", "pg_block_sleep", "sleep", ["shared_activity"], zero);
      const timestamp = now(); await first.insertFrogSleepEntity({ id: "pg_block_session", appId: "frogsleep", kind: "sleep_session",
        ownerUserId: "user_alice", partnerUserId: "user_bob", relationshipId: "pg_block_sleep", status: "active", payload: {}, createdAt: timestamp, updatedAt: timestamp });
      await recordBuddyBlock(second, "user_bob", "user_alice");
      assert.equal((await first.findFrogSleepBuddyDomainRelationship("frogsleep", "pg_block_focus"))?.status, "revoked");
      assert.equal((await first.findFrogSleepEntity("sleep_session", "frogsleep", "pg_block_session"))?.status, "cancelled");
      assert.ok((await first.listFrogSleepBuddyDomainSlots("frogsleep", "user_alice")).every(slot => slot.state === "available"));
      await revokeBuddyBlock(first, "user_bob", "user_alice");
      await assert.rejects(lifeB.execute("user_bob", "pg_block_sleep", "resume", 2), { statusCode: 409 });
    });
  } finally { await sql.end(); await first.close(); await second.close(); }
});

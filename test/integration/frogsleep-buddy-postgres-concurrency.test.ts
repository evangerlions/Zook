import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { BuddyDomainInvitationCommandService } from "../../src/modules/frogsleep/buddy-growth/buddy-domain-invitation-command.service.ts";
import { DevelopmentPasswordHasher } from "../../src/modules/auth/password-hasher.ts";
import { ApplicationError } from "../../src/shared/errors.ts";

const databaseUrl = process.env.FROGSLEEP_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("FROGSLEEP_TEST_DATABASE_URL is required and must point to a disposable PostgreSQL database.");
}

const appId = "frogsleep";
const now = () => new Date().toISOString();
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const keys = (left: string, right: string) => [
  { appId, userId: left, domain: "sleep" as const },
  { appId, userId: right, domain: "sleep" as const },
];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, label: string, milliseconds = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function seedInvitation(
  database: PostgresDatabase,
  invitationId: string,
  inviterUserId: string,
  inviteeUserId = "user_bob",
) {
  const createdAt = now();
  await database.upsertFrogSleepBuddyInvitationBundle({ id: invitationId, appId, inviterUserId,
    inviteeUserId, status: "pending", domains: ["sleep"], version: 1, domainInvitationIds: {},
    domainErrorCodes: {}, expiresAt: future(), createdAt, updatedAt: createdAt });
  await database.upsertFrogSleepBuddyInvitationDomainDecision({ appId, invitationId, domain: "sleep",
    status: "pending", version: 1, createdAt, updatedAt: createdAt });
}

async function clean(client: Client) {
  await client.query(`DELETE FROM zook_frogsleep_buddy_notification_outbox WHERE target_id LIKE 'task18_%'`);
  await client.query(`DELETE FROM zook_frogsleep_buddy_domain_slots
    WHERE user_id LIKE 'task18_%' OR user_id IN ('user_alice','user_bob') OR relationship_id LIKE 'task18_%'`);
  await client.query(`DELETE FROM zook_frogsleep_buddy_domain_relationships WHERE id LIKE 'task18_%'
    OR user_id_low LIKE 'task18_%' OR user_id_high LIKE 'task18_%'
    OR (user_id_low='user_alice' AND user_id_high='user_bob')`);
  await client.query(`DELETE FROM zook_frogsleep_buddy_invitation_domain_decisions WHERE invitation_id LIKE 'task18_%'`);
  await client.query(`DELETE FROM zook_frogsleep_buddy_invitation_bundles WHERE id LIKE 'task18_%'`);
  await client.query(`DELETE FROM zook_app_users WHERE user_id LIKE 'task18_%'`);
  await client.query(`DELETE FROM zook_users WHERE id LIKE 'task18_%'`);
}

test("live PostgreSQL buddy concurrency gate", async (suite) => {
  const sql = new Client({ connectionString: databaseUrl });
  await sql.connect();
  const seed = buildDefaultSeed(new DevelopmentPasswordHasher(), { includeFrogSleep: true });
  const first = await PostgresDatabase.create(databaseUrl, seed);
  const second = await PostgresDatabase.create(databaseUrl, seed);
  try {
    await clean(sql);
    for (const id of ["task18_charlie", "task18_left_a", "task18_left_b", "task18_right_a",
      "task18_right_b", "task18_order_a", "task18_order_b"]) {
      await first.insertUser({ id, email: `${id}@example.com`, passwordHash: "irrelevant",
        passwordAlgo: "test", status: "ACTIVE", createdAt: now() });
    }
    await first.insertAppUser({ id: "task18_app_user_charlie", appId, userId: "task18_charlie",
      status: "ACTIVE", joinedAt: now() });

    await suite.test("real migrations install and enforce slot and relationship constraints", async () => {
      const migrations = await sql.query(`SELECT name FROM zook_schema_migrations WHERE name LIKE '015_%' OR name LIKE '016_%' ORDER BY name`);
      assert.deepEqual(migrations.rows.map((row) => row.name), [
        "015_frogsleep_buddy_domain_slots.sql", "016_frogsleep_buddy_domain_relationships.sql",
      ]);
      await assert.rejects(sql.query(`INSERT INTO zook_frogsleep_buddy_domain_slots
        (app_id,user_id,domain,state,version) VALUES ($1,$2,'bundle','available',1)`, [appId, "user_alice"]), /check constraint/i);
      await assert.rejects(sql.query(`INSERT INTO zook_frogsleep_buddy_domain_slots
        (app_id,user_id,domain,state,relationship_id,version) VALUES ($1,$2,'sleep','occupied',NULL,1)`,
      [appId, "user_alice"]), /check constraint/i);
      await assert.rejects(sql.query(`INSERT INTO zook_frogsleep_buddy_domain_relationships
        (id,app_id,domain,user_id_low,user_id_high,status,paused_by_user_ids,version)
        VALUES ('task18_invalid_rel',$1,'sleep','user_bob','user_alice','active','{}',1)`, [appId]), /check constraint/i);
    });

    await suite.test("disjoint slot transactions enter callbacks concurrently", async () => {
      const enteredLeft = deferred(); const enteredRight = deferred(); const release = deferred();
      const left = first.withFrogSleepBuddyCommandTransaction(keys("task18_left_a", "task18_left_b"), async () => {
        enteredLeft.resolve(); await release.promise;
      });
      const right = second.withFrogSleepBuddyCommandTransaction(keys("task18_right_a", "task18_right_b"), async () => {
        enteredRight.resolve(); await release.promise;
      });
      await within(Promise.all([enteredLeft.promise, enteredRight.promise]), "disjoint callbacks");
      release.resolve();
      await within(Promise.all([left, right]), "disjoint transactions");
    });

    await suite.test("reversed and duplicate keys use a deadlock-free stable order", async () => {
      const start = deferred(); const entered = deferred(); const release = deferred();
      let callbackCount = 0;
      const run = (database: PostgresDatabase, slotKeys: ReturnType<typeof keys>) =>
        database.withFrogSleepBuddyCommandTransaction(slotKeys, async () => {
          callbackCount += 1; entered.resolve(); await release.promise;
        });
      const leftKeys = [...keys("task18_order_a", "task18_order_b"), keys("task18_order_a", "task18_order_b")[0]!];
      const rightKeys = [...keys("task18_order_b", "task18_order_a"), keys("task18_order_b", "task18_order_a")[1]!];
      const left = start.promise.then(async () => await run(first, leftKeys));
      const right = start.promise.then(async () => await run(second, rightKeys));
      start.resolve(); await within(entered.promise, "first ordered callback"); release.resolve();
      await within(Promise.all([left, right]), "ordered transactions");
      assert.equal(callbackCount, 2);
    });

    await suite.test("competing accepts produce one relationship and one occupied conflict", async () => {
      await seedInvitation(first, "task18_invite_alice", "user_alice");
      await seedInvitation(second, "task18_invite_charlie", "task18_charlie");
      const commands = [
        new BuddyDomainInvitationCommandService(first).accept("user_bob", "task18_invite_alice", "sleep",
          { expectedVersion: 1, idempotencyKey: "task18-key-alice" }),
        new BuddyDomainInvitationCommandService(second).accept("user_bob", "task18_invite_charlie", "sleep",
          { expectedVersion: 1, idempotencyKey: "task18-key-charlie" }),
      ];
      const outcomes = await within(Promise.allSettled(commands), "competing accepts");
      const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected") as PromiseRejectedResult[];
      assert.equal(accepted.length, 1); assert.equal(rejected.length, 1);
      assert.ok(rejected[0]!.reason instanceof ApplicationError);
      assert.deepEqual([rejected[0]!.reason.statusCode, rejected[0]!.reason.code], [409, "BUDDY_DOMAIN_SLOT_OCCUPIED"]);
      const decisions = await sql.query(`SELECT invitation_id,status FROM zook_frogsleep_buddy_invitation_domain_decisions
        WHERE invitation_id LIKE 'task18_invite_%' ORDER BY invitation_id`);
      assert.deepEqual(decisions.rows.map((row) => row.status).sort(), ["accepted", "pending"]);
      const relationships = await sql.query(`SELECT id FROM zook_frogsleep_buddy_domain_relationships
        WHERE user_id_low IN ('task18_charlie','user_alice','user_bob') AND user_id_high IN ('task18_charlie','user_alice','user_bob')`);
      assert.equal(relationships.rowCount, 1);
      const slots = await sql.query(`SELECT user_id,state,relationship_id FROM zook_frogsleep_buddy_domain_slots
        WHERE domain='sleep' AND user_id IN ('task18_charlie','user_alice','user_bob') ORDER BY user_id`);
      assert.equal(slots.rows.filter((row) => row.state === "occupied").length, 2);
      assert.equal(slots.rows.some((row) => row.user_id === "task18_charlie" && row.state === "occupied"), false);
      assert.equal(new Set(slots.rows.filter((row) => row.state === "occupied")
        .map((row) => row.relationship_id)).size, 1);
      const outbox = await sql.query(`SELECT id FROM zook_frogsleep_buddy_notification_outbox WHERE target_id LIKE 'task18_invite_%'`);
      assert.equal(outbox.rowCount, 1);
    });

    await suite.test("callback failure rolls back real writes and releases locks", async () => {
      await seedInvitation(first, "task18_rollback_invite", "user_alice", "task18_charlie");
      const slotKeys = keys("user_alice", "task18_charlie");
      await assert.rejects(first.withFrogSleepBuddyCommandTransaction(slotKeys, async () => {
        const createdAt = now();
        await first.insertFrogSleepBuddyDomainRelationship({ id: "task18_rollback_rel", appId, domain: "sleep",
          userIdLow: "task18_charlie", userIdHigh: "user_alice", status: "active", pausedByUserIds: [],
          version: 1, createdAt, updatedAt: createdAt });
        for (const userId of ["user_alice", "task18_charlie"]) {
          const slot = await first.findFrogSleepBuddyDomainSlot(appId, userId, "sleep");
          assert.ok(slot);
          await first.compareAndUpdateFrogSleepBuddyDomainSlot({ appId, userId, domain: "sleep",
            expectedVersion: slot.version, state: "occupied", relationshipId: "task18_rollback_rel", updatedAt: createdAt });
        }
        await first.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({ appId,
          invitationId: "task18_rollback_invite", domain: "sleep", expectedVersion: 1, status: "accepted",
          decidedByUserId: "task18_charlie", decidedAt: createdAt,
          idempotencyKeyHash: createHash("sha256").update("task18-rollback").digest("hex"), updatedAt: createdAt });
        await first.enqueueFrogSleepBuddyNotificationOutbox({ id: "task18_rollback_outbox", appId,
          recipientUserId: "user_alice", eventType: "invitation_accepted", targetType: "buddy_invitation",
          targetId: "task18_rollback_invite", deduplicationKey: "task18_rollback_outbox", safeRoute: {},
          status: "pending", attemptCount: 0, availableAt: createdAt, createdAt, updatedAt: createdAt });
        throw new Error("task18 forced rollback");
      }), /task18 forced rollback/);
      assert.equal((await first.findFrogSleepBuddyDomainRelationship(appId, "task18_rollback_rel")), undefined);
      const decision = await first.findFrogSleepBuddyInvitationDomainDecision(appId, "task18_rollback_invite", "sleep");
      assert.deepEqual([decision?.status, decision?.version], ["pending", 1]);
      const remaining = await sql.query(`SELECT COUNT(*)::int AS count FROM zook_frogsleep_buddy_notification_outbox
        WHERE id='task18_rollback_outbox'`);
      assert.equal(remaining.rows[0].count, 0);
      await within(second.withFrogSleepBuddyCommandTransaction(slotKeys, async () => undefined), "post-rollback lock");
    });
  } finally {
    await first.close(); await second.close(); await clean(sql); await sql.end();
  }
});

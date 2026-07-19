import assert from "node:assert/strict";
import test from "node:test";
import { PostgresBuddyDecisionSafetyTransaction } from "../../src/infrastructure/database/postgres/postgres-buddy-decision-safety-transaction.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const key = { appId: "frogsleep", invitationId: "invite_1", domain: "sleep" } as const;

function createHarness() {
  const events: string[] = [];
  const values: unknown[][] = [];
  const client = {
    query: async (sql: string, queryValues: unknown[] = []) => {
      events.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
      values.push(queryValues);
      return { rows: sql.includes("FOR UPDATE") ? [{ app_id: key.appId }] : [] };
    },
    release: () => { events.push("RELEASE"); },
  };
  const transaction = new PostgresBuddyDecisionSafetyTransaction({
    connect: async () => client,
    runWithClient: async (_client, fn) => { events.push("CONTEXT"); return await fn(); },
  });
  return { events, values, transaction };
}

test("postgres decision safety transaction locks one decision without any slot write", async () => {
  const harness = createHarness();
  const result = await harness.transaction.run(key, () => { harness.events.push("CALLBACK"); return "done"; });

  assert.equal(result, "done");
  assert.deepEqual(harness.events, ["BEGIN", "SELECT app_id, invitation_id, domain", "CONTEXT", "CALLBACK", "COMMIT", "RELEASE"]);
  assert.deepEqual(harness.values[1], ["frogsleep", "invite_1", "sleep"]);
  assert.equal(harness.events.some((event) => event.includes("slots") || event.includes("advisory")), false);
});

test("postgres decision safety transaction rolls back and releases after a callback failure", async () => {
  const harness = createHarness();

  await assert.rejects(harness.transaction.run(key, () => {
    harness.events.push("CALLBACK");
    throw new Error("callback failed");
  }), /callback failed/);

  assert.deepEqual(harness.events.slice(-3), ["CALLBACK", "ROLLBACK", "RELEASE"]);
  assert.equal(harness.events.includes("COMMIT"), false);
});

test("in-memory decision safety transaction rolls back decision writes without creating slots", async () => {
  const database = new InMemoryDatabase();
  const now = "2026-07-19T00:00:00.000Z";
  await database.upsertFrogSleepBuddyInvitationDomainDecision({ ...key, status: "pending", version: 1,
    createdAt: now, updatedAt: now });

  await assert.rejects(database.withFrogSleepBuddyInvitationDecisionSafetyTransaction(key, async () => {
    await database.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({ ...key, expectedVersion: 1,
      status: "declined", decidedByUserId: "user_bob", decidedAt: now, idempotencyKeyHash: "hash", updatedAt: now });
    throw new Error("callback failed");
  }), /callback failed/);

  assert.deepEqual([(await database.findFrogSleepBuddyInvitationDomainDecision("frogsleep", "invite_1", "sleep"))?.status,
    database.frogSleepBuddyDomainSlots], ["pending", []]);
});

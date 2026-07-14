import assert from "node:assert/strict";
import test from "node:test";
import { PostgresBuddyGrowthRepository } from "../../src/infrastructure/database/postgres/postgres-buddy-growth-repository.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import type { FrogSleepBuddyInvitationReceiptAttemptRecord } from "../../src/shared/types.ts";

function attempt(overrides: Partial<FrogSleepBuddyInvitationReceiptAttemptRecord> = {}): FrogSleepBuddyInvitationReceiptAttemptRecord {
  return {
    id: "receipt_opaque_1",
    appId: "frogsleep",
    inviterUserId: "user_alice",
    inviteeUserId: "user_bob",
    recipientIdentityHash: "a".repeat(64),
    domains: ["sleep", "focus"],
    domainsFingerprint: "domains_sha256_1",
    status: "recorded",
    expiresAt: "2026-07-21T00:00:00.000Z",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

test("receipt attempts preserve their original opaque identity and status for the same recipient tuple", async () => {
  const database = new InMemoryDatabase();
  await database.upsertFrogSleepBuddyInvitationReceiptAttempt(attempt());
  const stored = await database.upsertFrogSleepBuddyInvitationReceiptAttempt(attempt({
    id: "receipt_opaque_replayed",
    status: "decoy",
    updatedAt: "2026-07-15T01:00:00.000Z",
  }));

  assert.equal(stored.id, "receipt_opaque_1");
  assert.equal(stored.status, "recorded");
  assert.equal(stored.updatedAt, "2026-07-15T01:00:00.000Z");
  assert.equal((await database.findFrogSleepBuddyInvitationReceiptAttempt(
    "frogsleep", "user_alice", "a".repeat(64), "domains_sha256_1",
  ))?.id, "receipt_opaque_1");
});

test("receipt attempts keep different recipient hashes and domain fingerprints independent", async () => {
  const database = new InMemoryDatabase();
  await database.upsertFrogSleepBuddyInvitationReceiptAttempt(attempt());
  await database.upsertFrogSleepBuddyInvitationReceiptAttempt(attempt({
    id: "receipt_opaque_2", recipientIdentityHash: "b".repeat(64), domains: ["sleep"],
  }));
  await database.upsertFrogSleepBuddyInvitationReceiptAttempt(attempt({
    id: "receipt_opaque_3", domainsFingerprint: "domains_sha256_2", domains: ["focus"],
  }));

  assert.equal(database.frogSleepBuddyInvitationReceiptAttempts.length, 3);
});

test("receipt attempts exclude raw recipient data and scope lookup by inviter", async () => {
  const database = new InMemoryDatabase();
  await database.upsertFrogSleepBuddyInvitationReceiptAttempt(attempt());

  assert.equal(await database.findFrogSleepBuddyInvitationReceiptAttemptById("frogsleep", "user_mallory", "receipt_opaque_1"), undefined);
  assert.equal((await database.findFrogSleepBuddyInvitationReceiptAttemptById("frogsleep", "user_alice", "receipt_opaque_1"))?.recipientIdentityHash, "a".repeat(64));
  assert.deepEqual(Object.keys(attempt()).filter((key) => /email|locator|token|idempotency|body/i.test(key)), []);
});

test("PostgreSQL receipt attempt queries preserve immutable facts and inviter scoping", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const row = {
    id: "receipt_opaque_1", app_id: "frogsleep", inviter_user_id: "user_alice", invitee_user_id: "user_bob",
    recipient_identity_hash: "a".repeat(64), domains: ["sleep", "focus"], domains_fingerprint: "domains_sha256_1",
    status: "recorded", expires_at: "2026-07-21T00:00:00.000Z",
    created_at: "2026-07-15T00:00:00.000Z", updated_at: "2026-07-15T00:00:00.000Z",
  };
  const repository = new PostgresBuddyGrowthRepository({
    query: async (sql, values) => { queries.push({ sql, values }); return { rows: [row] }; },
  });

  await repository.upsertInvitationReceiptAttempt(attempt());
  await repository.findInvitationReceiptAttempt("frogsleep", "user_alice", "a".repeat(64), "domains_sha256_1");
  await repository.findInvitationReceiptAttemptById("frogsleep", "user_alice", "receipt_opaque_1");

  assert.match(queries[0]!.sql, /ON CONFLICT \(app_id, inviter_user_id, recipient_identity_hash, domains_fingerprint\) DO UPDATE SET/);
  assert.doesNotMatch(queries[0]!.sql, /id=EXCLUDED\.id|status=EXCLUDED\.status/);
  assert.match(queries[1]!.sql, /recipient_identity_hash=\$3 AND domains_fingerprint=\$4/);
  assert.match(queries[2]!.sql, /WHERE app_id=\$1 AND inviter_user_id=\$2 AND id=\$3/);
});

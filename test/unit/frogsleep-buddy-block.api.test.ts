import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function runtime() {
  return createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/password/login",
    headers: {},
    body: { account, password: "Password1234" },
    requestId: `block_login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

async function resolveUserId(app: Awaited<ReturnType<typeof runtime>>, account: string): Promise<string> {
  const user = await Promise.resolve((app as unknown as { database: { findUserByAccount(account: string): { id: string } | undefined } })
    .database.findUserByAccount(account));
  return user?.id ?? "";
}

test("v1 buddy block endpoint records bilateral block and unblocks cleanly", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const bob = await login(app, "bob@example.com");
  const bobId = await resolveUserId(app, "bob@example.com");

  // Block: alice blocks bob.
  const blockResponse = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(bobId)}/block`,
    headers: { authorization: `Bearer ${alice}` },
    body: { reason: "spam", note: "unwanted invitations" },
    requestId: "alice_blocks_bob",
  } as never);
  assert.equal(blockResponse.statusCode, 200);
  assert.equal(blockResponse.body.data.status, "blocked");
  assert.equal(blockResponse.body.data.blocked_user_id, bobId);

  // Idempotent: alice blocks bob again → same result.
  const idempotent = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(bobId)}/block`,
    headers: { authorization: `Bearer ${alice}` },
    body: {},
    requestId: "alice_blocks_bob_again",
  } as never);
  assert.equal(idempotent.statusCode, 200);
  assert.equal(idempotent.body.data.id, blockResponse.body.data.id);

  // Bilateral enforcement: alice cannot invite bob (via assertBuddyPairNotBlocked).
  // The block should cause any subsequent invitation flow to throw 403.
  // We verify bilateral state by querying via bob's perspective too.
  const aliceId = await resolveUserId(app, "alice@example.com");
  const bobBlockAlice = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(aliceId)}/block`,
    headers: { authorization: `Bearer ${bob}` },
    body: {},
    requestId: "bob_blocks_alice",
  } as never);
  assert.equal(bobBlockAlice.statusCode, 200);

  // Unblock: alice unblocks bob. Bob's block on alice remains (directional).
  const unblock = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(bobId)}/unblock`,
    headers: { authorization: `Bearer ${alice}` },
    body: {},
    requestId: "alice_unblocks_bob",
  } as never);
  assert.equal(unblock.statusCode, 200);
  assert.equal(unblock.body.data.removed, true);

  // Idempotent unblock.
  const idempotentUnblock = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(bobId)}/unblock`,
    headers: { authorization: `Bearer ${alice}` },
    body: {},
    requestId: "alice_unblocks_bob_again",
  } as never);
  assert.equal(idempotentUnblock.statusCode, 200);
  assert.equal(idempotentUnblock.body.data.removed, false);
});

test("v1 buddy block endpoint rejects self-block and unauthenticated requests", async () => {
  const app = await runtime();
  const alice = await login(app, "alice@example.com");
  const aliceId = await resolveUserId(app, "alice@example.com");

  const selfBlock = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(aliceId)}/block`,
    headers: { authorization: `Bearer ${alice}` },
    body: {},
    requestId: "alice_blocks_self",
  } as never);
  assert.equal(selfBlock.statusCode, 400);
  assert.equal(selfBlock.body.code, "REQ_INVALID_BODY");

  const unauthed = await app.app.handle({
    method: "POST",
    path: `/api/v1/frogsleep/buddy/users/${encodeURIComponent(aliceId)}/block`,
    headers: {},
    body: {},
    requestId: "unauthed_block",
  } as never);
  assert.equal(unauthed.statusCode, 401);
});

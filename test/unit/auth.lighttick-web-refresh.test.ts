import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { sha256 } from "../../src/shared/utils.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) {
    seed.appUsers.push({
      id: `lighttick-refresh-${userId}`, appId: "lighttick", userId,
      status: "ACTIVE", accountRegion: "CN", joinedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  return createApplication({ seed, lighttickEnabled: true });
}

type Runtime = Awaited<ReturnType<typeof setup>>;

function send(
  runtime: Runtime, token: string, key?: string,
  options: { body?: Record<string, string>; region?: string } = {},
) {
  return runtime.app.handle({
    method: "POST",
    path: "/api/v1/auth/refresh",
    headers: {
      cookie: `refreshToken=${token}`,
      "x-platform": "web",
      "x-app-region": options.region ?? "CN",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: options.body ?? { appId: "lighttick", clientType: "web" },
  });
}

function refreshCookie(response: Awaited<ReturnType<typeof send>>): string {
  assert.equal(response.statusCode, 200);
  assert.equal("refreshToken" in response.body.data, false);
  const cookie = response.headers?.["Set-Cookie"] ?? "";
  assert.match(cookie, /HttpOnly/);
  const token = cookie.match(/^refreshToken=([^;]+)/)?.[1];
  assert.ok(token);
  return token;
}

function makeAttempt(token: string, key = randomUUID()) {
  return { appId: "lighttick", cookieRefreshToken: token, lightTickWebRefreshAttempt: key };
}

const revoked = { code: "AUTH_REFRESH_TOKEN_REVOKED" };

test("LightTick Web recovers the same cookie after losing the response and after the browser received it", async () => {
  const runtime = await setup();
  const { authService, refreshTokenStore, tokenService } = runtime.services;
  const original = await authService.issueSession("user_alice", "lighttick");
  const legacy = await refreshTokenStore.getByRawToken(original.refreshToken);
  assert.ok(legacy);
  delete legacy.credentialVersion;
  await refreshTokenStore.update(legacy);
  const key = randomUUID();
  const first = await send(runtime, original.refreshToken, key);
  const successor = refreshCookie(first);
  assert.ok(successor !== original.refreshToken);
  for (const cookie of [original.refreshToken, successor]) {
    const replay = await send(runtime, cookie, key);
    assert.ok(refreshCookie(replay) === successor);
    assert.equal(tokenService.verifyAccessToken(replay.body.data.accessToken).expiresAt,
      tokenService.verifyAccessToken(first.body.data.accessToken).expiresAt);
  }
  const records = await refreshTokenStore.listByUserAndApp("lighttick", "user_alice");
  assert.equal(records.length, 2);
  const storedReceipt = await refreshTokenStore.getWebRefreshReceipt(sha256(key));
  assert.equal(storedReceipt?.predecessorId, legacy.id);
  assert.equal(storedReceipt?.successorId, records.find(record => !record.revokedAt)?.id);
  const storedValues = JSON.stringify({ records, storedReceipt });
  for (const secret of [original.refreshToken, successor, key]) assert.ok(!storedValues.includes(secret));
});

test("concurrent same-key refreshes return the one persisted successor", async () => {
  const runtime = await setup();
  const original = await runtime.services.authService.issueSession("user_alice", "lighttick");
  const command = makeAttempt(original.refreshToken);
  let seen = 0;
  let release!: () => void;
  const gated = new Promise<void>(resolve => { release = resolve; });
  const prepare = async () => {
    if (++seen === 2) release();
    await gated;
    return seen;
  };
  const outcomes = await Promise.all([
    runtime.services.authService.refreshWithPayload(command, prepare),
    runtime.services.authService.refreshWithPayload(command, prepare),
  ]);
  assert.equal(seen, 3); // The CAS loser rebuilds its payload from the committed receipt.
  assert.ok(outcomes[0]?.session.refreshToken === outcomes[1]?.session.refreshToken);
  assert.equal((await runtime.services.refreshTokenStore.listByUserAndApp("lighttick", "user_alice")).length, 2);
});

test("different keys keep one concurrent winner and a live key cannot be reused with another account", async () => {
  const runtime = await setup();
  const { authService, refreshTokenStore } = runtime.services;
  const original = await authService.issueSession("user_alice", "lighttick");
  const other = await authService.issueSession("user_bob", "lighttick");
  const keys = [randomUUID(), randomUUID()];
  const responses = await Promise.all(keys.map(key => send(runtime, original.refreshToken, key)));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 401]);
  const winningKey = keys[responses.findIndex(response => response.statusCode === 200)]!;
  const foreign = await send(runtime, other.refreshToken, winningKey);
  assert.equal(foreign.statusCode, 401);
  assert.equal(foreign.body.code, revoked.code);
  assert.equal((await refreshTokenStore.listByUserAndApp("lighttick", "user_bob")).length, 1);
});

test("receipt recovery requires the explicit LightTick Web cookie path and a valid UUID", async () => {
  const runtime = await setup();
  const { authService, refreshTokenStore } = runtime.services;
  const original = await authService.issueSession("user_alice", "lighttick");
  const invalid = await send(runtime, original.refreshToken, "invalid-key");
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.code, "REQ_FIELD_INVALID");
  const key = randomUUID();
  refreshCookie(await send(runtime, original.refreshToken, key));
  for (const body of [
    { appId: "lighttick", clientType: "app", refreshToken: original.refreshToken },
    { appId: "lighttick", clientType: "web", refreshToken: original.refreshToken },
    { appId: "lighttick" },
    { clientType: "web" },
    { appId: "app_a", clientType: "web" },
  ]) {
    assert.equal((await send(runtime, original.refreshToken, key, { body })).statusCode, 401);
  }
  assert.equal((await send(runtime, original.refreshToken)).statusCode, 401);
  const other = await authService.issueSession("user_alice", "app_a");
  assert.equal((await send(runtime, other.refreshToken, key, { body: { appId: "app_a", clientType: "web" } })).statusCode, 200);
  const ordinary = await authService.issueSession("user_alice", "lighttick");
  const ordinarySuccess = refreshCookie(await send(runtime, ordinary.refreshToken));
  assert.equal((await send(runtime, ordinary.refreshToken, key)).statusCode, 401);
  assert.equal((await refreshTokenStore.getByRawToken(ordinarySuccess))?.webRefreshAttemptHash, undefined);
});

test("the receipt and either credential expire authoritatively while a fresh attempt still works", async () => {
  const runtime = await setup();
  const { authService, refreshTokenStore } = runtime.services;
  const now = new Date();
  const original = await authService.issueSession("user_alice", "lighttick", now);
  const attempt = makeAttempt(original.refreshToken);
  const accepted = await authService.refresh(attempt, now);
  const expiry = new Date(now.getTime() + 20_000);
  for (const cookie of [original.refreshToken, accepted.refreshToken]) {
    await assert.rejects(() => authService.refresh({ ...attempt, cookieRefreshToken: cookie }, expiry), revoked);
  }
  const successor = await refreshTokenStore.getByRawToken(accepted.refreshToken);
  assert.ok(successor);
  await refreshTokenStore.update({ ...successor, expiresAt: now.toISOString() });
  await assert.rejects(() => authService.refresh(attempt, now), revoked);
  await refreshTokenStore.update(successor);
  const predecessor = await refreshTokenStore.getByRawToken(original.refreshToken);
  assert.ok(predecessor);
  await refreshTokenStore.update({ ...predecessor, expiresAt: now.toISOString() });
  await assert.rejects(() => authService.refresh({ ...attempt, cookieRefreshToken: accepted.refreshToken }, now), revoked);
  assert.ok(await authService.refresh(makeAttempt(accepted.refreshToken), expiry));
});

test("logout, later rotation and password changes invalidate a previously accepted refresh receipt", async () => {
  const runtime = await setup();
  const { authService, tokenService } = runtime.services;
  for (const action of ["current", "all", "rotated", "password"] as const) {
    const original = await authService.issueSession("user_alice", "lighttick");
    const attempt = makeAttempt(original.refreshToken);
    const accepted = await authService.refresh(attempt);
    if (action === "rotated") {
      const next = await authService.refresh(makeAttempt(accepted.refreshToken));
      await assert.rejects(() => authService.refresh({ ...attempt, cookieRefreshToken: next.refreshToken }), revoked);
    } else if (action === "password") {
      await authService.changePassword({
        appId: "app_a", userId: "user_alice", currentPassword: "Password1234", newPassword: "Changed12345",
      });
    } else {
      await authService.logout({ appId: "lighttick", scope: action, cookieRefreshToken: accepted.refreshToken },
        tokenService.verifyAccessToken(accepted.accessToken));
    }
    for (const cookieRefreshToken of [original.refreshToken, accepted.refreshToken]) {
      await assert.rejects(() => authService.refresh({ ...attempt, cookieRefreshToken }), revoked);
    }
  }
});

test("account policy still gates both initial refresh and replay without revoking a valid winner", async () => {
  const runtime = await setup();
  const { authService, refreshTokenStore } = runtime.services;
  const deniedOriginal = await authService.issueSession("user_alice", "lighttick");
  const deniedKey = randomUUID();
  const denied = await send(runtime, deniedOriginal.refreshToken, deniedKey, { region: "GLOBAL" });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, "AUTH_LOGIN_FORBIDDEN");
  assert.equal(await refreshTokenStore.getWebRefreshReceipt(sha256(deniedKey)), undefined);
  assert.equal((await send(runtime, deniedOriginal.refreshToken, deniedKey)).statusCode, 401);

  const original = await authService.issueSession("user_alice", "lighttick");
  const key = randomUUID();
  const successor = refreshCookie(await send(runtime, original.refreshToken, key));
  const replay = await send(runtime, original.refreshToken, key, { region: "GLOBAL" });
  assert.equal(replay.statusCode, 403);
  assert.equal(replay.body.code, "AUTH_LOGIN_FORBIDDEN");
  assert.ok(refreshCookie(await send(runtime, original.refreshToken, key)) === successor);
  const member = await runtime.database.findAppUser("lighttick", "user_alice");
  assert.ok(member);
  member.status = "BLOCKED";
  const blocked = await send(runtime, original.refreshToken, key);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, "APP_MEMBER_BLOCKED");
});

test("a successor rotated during response preparation cannot be returned by replay", async () => {
  const runtime = await setup();
  const { authService } = runtime.services;
  const original = await authService.issueSession("user_alice", "lighttick");
  const attempt = makeAttempt(original.refreshToken);
  const accepted = await authService.refresh(attempt);
  await assert.rejects(() => authService.refreshWithPayload(attempt, async () => {
    await authService.refresh(makeAttempt(accepted.refreshToken));
  }), revoked);
});

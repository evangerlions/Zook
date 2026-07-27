import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { BuddyRateLimiter } from "../../src/modules/frogsleep/buddy-growth/buddy-rate-limit.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";

async function createLimiter(now: () => number = () => Date.now()): Promise<BuddyRateLimiter> {
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  return new BuddyRateLimiter(kvManager, now);
}

test("buddy rate limiter isolates scopes and actors and emits retry metadata", async () => {
  let now = 1_000;
  const limiter = await createLimiter(() => now);
  await limiter.assert("preview", "alice", 2, 60_000);
  await limiter.assert("preview", "alice", 2, 60_000);
  await limiter.assert("preview", "bob", 2, 60_000);
  await assert.rejects(async () => {
    await limiter.assert("preview", "alice", 2, 60_000);
  }, (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "AUTH_RATE_LIMITED");
    assert.equal(error.details?.retry_after_seconds, 60);
    return true;
  });
  // Bob's bucket is independent — still under limit.
  await assert.doesNotReject(async () => {
    await limiter.assert("preview", "bob", 2, 60_000);
  });
  // Window expires — alice gets a fresh bucket.
  now += 60_000;
  await assert.doesNotReject(async () => {
    await limiter.assert("preview", "alice", 2, 60_000);
  });
});

test("buddy rate limiter rejects when limit exceeded and resets after window", async () => {
  let now = 1_000_000;
  const limiter = await createLimiter(() => now);
  // 20 requests allowed per hour for interaction scope.
  for (let i = 0; i < 20; i += 1) {
    await limiter.assert("interaction", "carol", 20, 3_600_000);
  }
  await assert.rejects(async () => {
    await limiter.assert("interaction", "carol", 20, 3_600_000);
  }, (error: unknown) => error instanceof ApplicationError && error.statusCode === 429);
  now += 3_600_000;
  await assert.doesNotReject(async () => {
    await limiter.assert("interaction", "carol", 20, 3_600_000);
  });
});

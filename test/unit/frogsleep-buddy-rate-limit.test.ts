import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { BuddyRateLimiter } from "../../src/modules/frogsleep/buddy-growth/buddy-rate-limit.ts";

test("buddy rate limiter isolates scopes and actors and emits retry metadata", () => {
  let now = 1_000;
  const limiter = new BuddyRateLimiter(() => now);
  limiter.assert("preview", "alice", 2, 60_000);
  limiter.assert("preview", "alice", 2, 60_000);
  limiter.assert("preview", "bob", 2, 60_000);
  assert.throws(() => limiter.assert("preview", "alice", 2, 60_000), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "AUTH_RATE_LIMITED");
    assert.equal(error.details?.retry_after_seconds, 60);
    return true;
  });
  now += 60_000;
  assert.doesNotThrow(() => limiter.assert("preview", "alice", 2, 60_000));
});

import assert from "node:assert/strict";
import test from "node:test";

import { TelemetryRateLimiter } from "../../src/modules/telemetry/telemetry-rate-limiter.ts";

test("rate limiter stays bounded without resetting active client windows", () => {
  const limiter = new TelemetryRateLimiter(1, 60_000, 2, () => 1_000);

  assert.equal(limiter.allow("first"), true);
  assert.equal(limiter.allow("second"), true);
  assert.equal(limiter.allow("first"), false);
  assert.equal(limiter.allow("third"), false);
  assert.equal(limiter.allow("first"), false);
});

test("rate limiter admits new keys after tracked windows expire", () => {
  let now = 1_000;
  const limiter = new TelemetryRateLimiter(1, 60_000, 2, () => now);

  assert.equal(limiter.allow("first"), true);
  assert.equal(limiter.allow("second"), true);
  now += 60_000;
  assert.equal(limiter.allow("third"), true);
});

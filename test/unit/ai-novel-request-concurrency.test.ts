import assert from "node:assert/strict";
import test from "node:test";
import { AiNovelRequestConcurrency } from "../../src/modules/ai-novel/credits/ai-novel-request-concurrency.ts";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

test("admission is limited per account and release requires the matching request", () => {
  const limiter = new AiNovelRequestConcurrency();
  assert.equal(limiter.tryAcquire("u", "a", "r1"), true);
  assert.equal(limiter.tryAcquire("u", "b", "r2"), true);
  assert.equal(limiter.tryAcquire("u", "c", "r3"), true);
  assert.equal(limiter.tryAcquire("u", "d", "r4"), false);
  assert.equal(limiter.tryAcquire("v", "a", "r1"), true);
  limiter.release("u", "a", "wrong");
  assert.equal(limiter.tryAcquire("u", "d", "r4"), false);
  limiter.release("u", "a", "r1");
  assert.equal(limiter.tryAcquire("u", "d", "r4"), true);
  assert.equal(limiter.tryAcquire("u", "d", "r4"), false);
});

test("billing environments and fresh application instances have independent state", () => {
  const limiter = new AiNovelRequestConcurrency();
  for (const id of ["a", "b", "c"]) assert.equal(limiter.tryAcquire("u", id, id), true);
  assert.equal(inBillingEnvironment("sandbox", () => limiter.tryAcquire("u", "a", "a")), true);
  assert.equal(new AiNovelRequestConcurrency().tryAcquire("u", "a", "a"), true);
});

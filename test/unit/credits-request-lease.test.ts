import assert from "node:assert/strict";
import test from "node:test";
import { startCreditsRequestLease } from "../../src/modules/ai-novel/credits/credits-request-lease.ts";
import type { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";

test("heartbeat renews live requests and stops on terminal cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  const credits = { renewRequest: async () => { calls++; } } as unknown as AiNovelCreditsService;
  const lease = startCreditsRequestLease(credits, "u", "job", "r");
  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  lease.stop();
  t.mock.timers.tick(180_000);
  assert.equal(calls, 1);
  assert.equal(lease.signal.aborted, false);
});

test("lost ownership aborts the provider signal; caller cancellation also propagates", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const credits = { renewRequest: async () => { throw Error("lease lost"); } } as unknown as AiNovelCreditsService;
  const caller = new AbortController();
  const lease = startCreditsRequestLease(credits, "u", "job", "r", caller.signal);
  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lease.signal.aborted, true);
  assert.equal(lease.signal.reason.message, "lease lost");
  lease.stop();
  const other = startCreditsRequestLease(credits, "v", "other", "r", caller.signal);
  caller.abort(new Error("cancelled"));
  assert.equal(other.signal.aborted, true);
  other.stop();
});

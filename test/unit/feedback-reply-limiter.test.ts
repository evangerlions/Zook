import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { FeedbackReplyLimiter } from "../../src/services/feedback-reply-limiter.ts";

test("feedback daily quotas count mixed inputs and allow a new Shanghai day", async () => {
  let now = Date.parse("2026-11-21T10:00:00.000Z");
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const limiter = new FeedbackReplyLimiter(kv, () => now);
  await limiter.consume("alice", "one", "mixed-key", { text: 1, images: 20 });
  await limiter.consume("alice", "one", "mixed-key", { text: 1, images: 20 });
  await assert.rejects(limiter.consume("alice", "two", "new-image", { text: 0, images: 1 }), { statusCode: 429 });
  for (let index = 1; index < 200; index += 1) {
    now += 60_000;
    await limiter.consume("alice", index % 2 === 0 ? "one" : "two", `text-${index}`, { text: 1, images: 0 });
  }
  await assert.rejects(limiter.consume("alice", "two", "new-text", { text: 1, images: 0 }), { statusCode: 429 });
  now = Date.parse("2026-11-21T16:00:00.000Z");
  await limiter.consume("alice", "two", "new-day", { text: 1, images: 1 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { RedisJobQueue } from "../../src/infrastructure/queue/bullmq/redis-queue.ts";

test("RedisJobQueue processDueJobs returns when Redis queue is empty", async () => {
  const queue = new RedisJobQueue("redis://localhost:1") as unknown as {
    client: {
      zPopMin: () => Promise<null>;
    };
    ensureConnected: () => Promise<void>;
    processDueJobs: RedisJobQueue["processDueJobs"];
  };
  queue.client = {
    zPopMin: async () => null,
  };
  queue.ensureConnected = async () => {};

  let handled = false;
  await queue.processDueJobs(async () => {
    handled = true;
  });

  assert.equal(handled, false);
});

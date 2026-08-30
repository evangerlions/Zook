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

test("RedisJobQueue handles the object returned by redis v5 zPopMin", async () => {
  const deleted: string[] = [];
  let popped = false;
  const queue = new RedisJobQueue("redis://localhost:1") as unknown as {
    client: {
      zPopMin: () => Promise<{ value: string; score: number } | null>;
      get: (key: string) => Promise<string | null>;
      del: (key: string) => Promise<number>;
      zAdd: () => Promise<number>;
    };
    ensureConnected: () => Promise<void>;
    processDueJobs: RedisJobQueue["processDueJobs"];
  };
  queue.client = {
    zPopMin: async () => popped ? null : (popped = true, { value: "job-1", score: 1 }),
    get: async () => JSON.stringify({ id: "job-1", name: "lighttick.ai.run", payload: {},
      attemptsMade: 0, maxAttempts: 3, backoffMs: 1000, availableAt: "2026-01-01T00:00:00.000Z" }),
    del: async key => (deleted.push(key), 1),
    zAdd: async () => 1,
  };
  queue.ensureConnected = async () => {};

  const handled: string[] = [];
  await queue.processDueJobs(async job => { handled.push(job.id); }, new Date("2030-01-01T00:00:00.000Z"));

  assert.deepEqual(handled, ["job-1"]);
  assert.deepEqual(deleted, ["zook:queue:job:job-1"]);
});

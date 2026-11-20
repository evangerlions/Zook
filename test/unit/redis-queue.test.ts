import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { DeferJobError } from "../../src/infrastructure/queue/job-queue.ts";
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

const redisUrl = process.env.LIGHTTICK_TEST_REDIS_URL;
test("Redis tutor recovery preserves a deferral and repairs a missing delivery", { skip: !redisUrl }, async () => {
  const scope = `test:tutor:${randomUUID()}`;
  const jobId = "tutor-work";
  const queue = new RedisJobQueue(redisUrl!, scope, true);
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  try {
    await queue.add("learning", { revision: 1 }, { jobId });
    const now = new Date();
    await queue.processDueJobs(() => { throw new DeferJobError(1500); }, now, 1);
    const retry = await queue.add("learning", { revision: 2 }, { jobId });
    assert.equal(retry.availableAt, new Date(now.getTime() + 1500).toISOString());
    assert.equal(retry.attemptsMade, 0);
    assert.equal(retry.payload.revision, 1);
    await queue.processDueJobs(() => assert.fail("Deferred delivery ran too early"), now, 1);

    const delivered: string[] = [];
    await queue.processDueJobs(job => { delivered.push(job.id); }, new Date(now.getTime() + 1600), 1);
    assert.deepEqual(delivered, [jobId]);

    await queue.add("learning", { revision: 1 }, { jobId });
    await redis.zRem(scope + ":due", jobId);
    const restored = await queue.add("learning", { revision: 2 }, { jobId });
    assert.equal(restored.payload.revision, 2);
    assert.ok(await redis.zScore(scope + ":due", jobId));
  } finally {
    await redis.del([scope + ":due", `${scope}:job:${jobId}`]);
    await queue.close();
    await redis.quit();
  }
});

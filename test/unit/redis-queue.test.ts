import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { DeferJobError } from "../../src/infrastructure/queue/job-queue.ts";
import { RedisJobQueue } from "../../src/infrastructure/queue/bullmq/redis-queue.ts";

test("RedisJobQueue returns when Redis queue is empty", async () => {
  const queue = new RedisJobQueue("redis://localhost:1") as unknown as {
    client: { eval: () => Promise<null> };
    ensureConnected: () => Promise<void>;
    processDueJobs: RedisJobQueue["processDueJobs"];
  };
  queue.client = { eval: async () => null };
  queue.ensureConnected = async () => {};
  await queue.processDueJobs(() => assert.fail("The empty queue dispatched a job"));
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

test("Redis recovers an abandoned claim and rejects stale acknowledgements", { skip: !redisUrl }, async () => {
  const scope = `test:shared:${randomUUID()}`;
  const jobId = "shared-work";
  const firstWorker = new RedisJobQueue(redisUrl!, scope);
  const secondWorker = new RedisJobQueue(redisUrl!, scope);
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  const claimed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let original: Promise<void> | undefined;
  try {
    await firstWorker.add("learning", { revision: 1 }, { jobId });
    original = firstWorker.processDueJobs(async () => {
      claimed.resolve();
      await release.promise;
      throw new Error("The original delivery failed after lease recovery");
    }, new Date(), 1);
    await claimed.promise;
    assert.equal((await secondWorker.add("learning", { revision: 2 }, { jobId })).payload.revision, 1);
    await secondWorker.processDueJobs(() => assert.fail("An active claim was dispatched twice"), new Date(), 1);

    await redis.zAdd(scope + ":processing", { score: 1, value: jobId });
    const delivered: string[] = [];
    await secondWorker.processDueJobs(job => { delivered.push(job.id); }, new Date(), 1);
    assert.deepEqual(delivered, [jobId]);
    release.resolve();
    await original;
    assert.equal(await redis.get(scope + ":job:" + jobId), null);
    assert.equal(await redis.zScore(scope + ":due", jobId), null);
  } finally {
    release.resolve();
    await original?.catch(() => {});
    await redis.del([scope + ":due", scope + ":processing", scope + ":claims", scope + ":dlq", scope + ":job:" + jobId]);
    await firstWorker.close();
    await secondWorker.close();
    await redis.quit();
  }
});

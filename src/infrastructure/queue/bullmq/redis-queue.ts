import { createClient, type RedisClientType } from "redis";
import type { QueueJob } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import type { JobQueue } from "../job-queue.ts";

const QUEUE_SCOPE = "zook:queue";
const DUE_JOBS_KEY = `${QUEUE_SCOPE}:due`;
const PROCESSING_JOBS_KEY = `${QUEUE_SCOPE}:processing`;
const JOB_KEY_PREFIX = `${QUEUE_SCOPE}:job:`;
const DLQ_KEY = `${QUEUE_SCOPE}:dlq`;
const PROCESSING_TTL_MS = 5 * 60 * 1000;
const PROCESSING_REQUEUE_BATCH = 50;

const POP_DUE_JOB_SCRIPT = `
local popped = redis.call('ZPOPMIN', KEYS[1], 1)
if #popped == 0 then return nil end
local jobId = popped[1]
local score = tonumber(popped[2])
if score > tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], score, jobId)
  return nil
end
local jobKey = ARGV[2] .. jobId
local jobBody = redis.call('GET', jobKey)
if not jobBody then
  return nil
end
redis.call('ZADD', KEYS[2], tonumber(ARGV[1]) + tonumber(ARGV[3]), jobId)
return { jobId, jobBody }
`;

export class RedisJobQueue implements JobQueue {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<void>;

  constructor(redisUrl: string) {
    this.client = createClient({
      url: redisUrl,
    });
  }

  async add(
    name: string,
    payload: Record<string, unknown>,
    options: { attempts?: number; backoffMs?: number } = {},
  ): Promise<QueueJob> {
    await this.ensureConnected();

    const job: QueueJob = {
      id: randomId("job"),
      name,
      payload,
      attemptsMade: 0,
      maxAttempts: options.attempts ?? 5,
      backoffMs: options.backoffMs ?? 1000,
      availableAt: new Date().toISOString(),
    };

    await this.storeJob(job);
    return job;
  }

  async processDueJobs(
    handler: (job: QueueJob) => Promise<void> | void,
    now = new Date(),
  ): Promise<void> {
    await this.ensureConnected();
    const nowMs = now.getTime();
    await this.requeueExpiredProcessing(nowMs);

    while (true) {
      const popped = await this.client.eval(POP_DUE_JOB_SCRIPT, {
        keys: [DUE_JOBS_KEY, PROCESSING_JOBS_KEY],
        arguments: [String(nowMs), JOB_KEY_PREFIX, String(PROCESSING_TTL_MS)],
      });

      if (!popped || !Array.isArray(popped) || popped.length < 2) {
        return;
      }

      const [jobId, rawJob] = popped as [string, string];
      const job = JSON.parse(rawJob) as QueueJob;

      try {
        await handler(job);
        await this.client.del(this.buildJobKey(job.id));
        await this.client.zRem(PROCESSING_JOBS_KEY, job.id);
      } catch (error) {
        job.attemptsMade += 1;
        job.failedReason = error instanceof Error ? error.message : "Unknown queue error";

        if (job.attemptsMade >= job.maxAttempts) {
          await this.client.del(this.buildJobKey(job.id));
          await this.client.zRem(PROCESSING_JOBS_KEY, job.id);
          await this.client.zAdd(DLQ_KEY, {
            score: Date.now(),
            value: JSON.stringify(job),
          });
          continue;
        }

        const delay = job.backoffMs * 2 ** (job.attemptsMade - 1);
        job.availableAt = new Date(nowMs + delay).toISOString();
        await this.client.zRem(PROCESSING_JOBS_KEY, job.id);
        await this.storeJob(job);
      }
    }
  }

  async close(): Promise<void> {
    if (!this.client.isOpen) {
      return;
    }

    await this.client.quit();
  }

  private async storeJob(job: QueueJob): Promise<void> {
    const multi = this.client.multi();
    multi.set(this.buildJobKey(job.id), JSON.stringify(job));
    multi.zAdd(DUE_JOBS_KEY, {
      score: new Date(job.availableAt).getTime(),
      value: job.id,
    });
    await multi.exec();
  }

  private buildJobKey(jobId: string): string {
    return `${JOB_KEY_PREFIX}${jobId}`;
  }

  private async requeueExpiredProcessing(nowMs: number): Promise<void> {
    const expired = await this.client.zRangeByScore(
      PROCESSING_JOBS_KEY,
      0,
      nowMs,
      {
        LIMIT: {
          offset: 0,
          count: PROCESSING_REQUEUE_BATCH,
        },
      },
    );

    if (!expired.length) {
      return;
    }

    const multi = this.client.multi();
    for (const jobId of expired) {
      multi.zRem(PROCESSING_JOBS_KEY, jobId);
      multi.zAdd(DUE_JOBS_KEY, {
        score: nowMs,
        value: jobId,
      });
    }
    await multi.exec();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.client.connect().finally(() => {
        this.connectPromise = undefined;
      });
    }

    await this.connectPromise;
  }
}

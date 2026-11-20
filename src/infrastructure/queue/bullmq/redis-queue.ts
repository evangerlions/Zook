import { DeferJobError } from "../job-queue.ts";
import { createClient, type RedisClientType } from "redis";
import type { QueueJob } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import type { JobQueue } from "../job-queue.ts";

export class RedisJobQueue implements JobQueue {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<void>;

  constructor(private readonly redisUrl: string, private readonly scope = "zook:queue", private readonly preserveScheduled = false) {
    this.client = createClient({
      url: this.redisUrl,
      disableOfflineQueue: this.preserveScheduled,
    });
    if (this.preserveScheduled) this.client.on("error", () => { /* Command failures are reported by the consumer. */ });
  }

  forLightTickInteraction(): RedisJobQueue {
    return new RedisJobQueue(this.redisUrl, "zook:queue:lighttick-interaction", true);
  }

  async add(
    name: string,
    payload: Record<string, unknown>,
    options: { attempts?: number; backoffMs?: number; jobId?: string } = {},
  ): Promise<QueueJob> {
    await this.ensureConnected();

    const job: QueueJob = {
      id: options.jobId ?? randomId("job"),
      name,
      payload,
      attemptsMade: 0,
      maxAttempts: options.attempts ?? 5,
      backoffMs: options.backoffMs ?? 1000,
      availableAt: new Date().toISOString(),
    };

    if (this.preserveScheduled) {
      const result = await this.client.eval(
        `local existing = redis.call('GET', KEYS[1])
         if existing and redis.call('ZSCORE', KEYS[2], ARGV[1]) then return existing end
         redis.call('SET', KEYS[1], ARGV[2])
         redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
         return ARGV[2]`,
        { keys: [this.buildJobKey(job.id), this.scope + ":due"],
          arguments: [job.id, JSON.stringify(job), String(Date.parse(job.availableAt))] },
      );
      return JSON.parse(String(result)) as QueueJob;
    }
    await this.storeJob(job);
    return job;
  }

  async processDueJobs(
    handler: (job: QueueJob) => Promise<void> | void,
    now = new Date(),
    limit = Infinity,
  ): Promise<void> {
    await this.ensureConnected();
    const nowMs = now.getTime();

    for (let processed = 0; processed < limit; processed++) {
      const rawJob = this.preserveScheduled
        ? await this.claimDueDelivery(nowMs)
        : await this.popSharedDelivery(nowMs);
      if (rawJob === undefined) return;
      if (rawJob === null) continue;
      const job = JSON.parse(rawJob) as QueueJob;

      try {
        await handler(job);
        if (this.preserveScheduled) {
          // Recovery can recreate the delivery while this handler owns its PostgreSQL lease.
          await this.client.eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] and not redis.call('ZSCORE', KEYS[2], ARGV[2]) then return redis.call('DEL', KEYS[1]) end",
            { keys: [this.buildJobKey(job.id), this.scope + ":due"], arguments: [rawJob, job.id] },
          );
        } else {
          await this.client.del(this.buildJobKey(job.id));
        }
      } catch (error) {
        if (error instanceof DeferJobError) {
          job.availableAt = new Date(nowMs + error.delayMs).toISOString();
          await this.storeJob(job);
          continue;
        }
        job.attemptsMade += 1;
        job.failedReason =
          error instanceof Error ? error.message : "Unknown queue error";

        if (job.attemptsMade >= job.maxAttempts) {
          await this.client.del(this.buildJobKey(job.id));
          await this.client.zAdd(this.scope + ":dlq", {
            score: Date.now(),
            value: JSON.stringify(job),
          });
          continue;
        }

        const delay = job.backoffMs * 2 ** (job.attemptsMade - 1);
        job.availableAt = new Date(nowMs + delay).toISOString();
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

  private async claimDueDelivery(nowMs: number): Promise<string | null | undefined> {
    // Future deliveries stay indexed even if a consumer and recovery scan run concurrently.
    const id = await this.client.eval(
      `local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
       if #ids == 0 then return false end
       redis.call('ZREM', KEYS[1], ids[1])
       return ids[1]`,
      { keys: [this.scope + ":due"], arguments: [String(nowMs)] },
    );
    return id === null ? undefined : this.client.get(this.buildJobKey(String(id)));
  }

  private async popSharedDelivery(nowMs: number): Promise<string | null | undefined> {
    const first = await this.client.zPopMin(this.scope + ":due");
    if (!first) return undefined;
    const score = Number(first.score);
    if (Number.isFinite(score) && score > nowMs) {
      await this.client.zAdd(this.scope + ":due", { score, value: first.value });
      return undefined;
    }
    return this.client.get(this.buildJobKey(first.value));
  }

  private async storeJob(job: QueueJob): Promise<void> {
    const due = this.scope + ":due";
    const score = Date.parse(job.availableAt);
    const key = this.buildJobKey(job.id);
    const value = JSON.stringify(job);
    if (this.preserveScheduled) {
      await this.client.multi().set(key, value).zAdd(due, { score, value: job.id }).exec();
      return;
    }
    await this.client.set(key, value);
    await this.client.zAdd(due, { score, value: job.id });
  }

  private buildJobKey(jobId: string): string {
    return `${this.scope}:job:${jobId}`;
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

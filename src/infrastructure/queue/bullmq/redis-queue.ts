import { DeferJobError } from "../job-queue.ts";
import { createClient, type RedisClientType } from "redis";
import type { QueueJob } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import type { JobQueue } from "../job-queue.ts";

export class RedisJobQueue implements JobQueue {
  private readonly client: RedisClientType;
  private connectPromise?: Promise<void>;

  constructor(private readonly redisUrl: string, private readonly scope = "zook:queue") {
    this.client = createClient({
      url: this.redisUrl,
    });
  }

  forLightTickInteraction(): RedisJobQueue {
    return new RedisJobQueue(this.redisUrl, "zook:queue:lighttick-interaction");
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
      const popped = await this.client.zPopMin(this.scope + ":due");
      const first = popped;
      if (!first) {
        return;
      }

      const score = Number(first.score);
      if (Number.isFinite(score) && score > nowMs) {
        await this.client.zAdd(this.scope + ":due", {
          score,
          value: first.value,
        });
        return;
      }

      const rawJob = await this.client.get(this.buildJobKey(first.value));
      if (!rawJob) {
        continue;
      }

      const job = JSON.parse(rawJob) as QueueJob;

      try {
        await handler(job);
        await this.client.del(this.buildJobKey(job.id));
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

  private async storeJob(job: QueueJob): Promise<void> {
    await this.client.set(this.buildJobKey(job.id), JSON.stringify(job));
    await this.client.zAdd(this.scope + ":due", {
      score: new Date(job.availableAt).getTime(),
      value: job.id,
    });
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

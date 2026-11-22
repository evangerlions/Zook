import { createClient, type RedisClientType } from "redis";
import type { QueueJob } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { DeferJobError, type JobQueue } from "../job-queue.ts";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const RECOVERY_BATCH = 50;

const ENQUEUE_JOB = `
local existing = redis.call('GET', KEYS[1])
if existing and (redis.call('ZSCORE', KEYS[2], ARGV[1]) or redis.call('ZSCORE', KEYS[3], ARGV[1])) then
  return existing
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return ARGV[2]
`;

// A lost worker leaves its job payload available for redelivery. The token
// prevents its late acknowledgement from altering a newer delivery.
const RECOVER_JOBS = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
for _, id in ipairs(expired) do
  redis.call('ZREM', KEYS[2], id)
  redis.call('HDEL', KEYS[3], id)
  if redis.call('EXISTS', ARGV[3] .. id) == 1 then
    redis.call('ZADD', KEYS[1], ARGV[1], id)
  end
end
`;

const CLAIM_JOB = `
local jobs = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #jobs == 0 then return false end
local id = jobs[1]
redis.call('ZREM', KEYS[1], id)
local body = redis.call('GET', ARGV[2] .. id)
if not body then return {} end
redis.call('ZADD', KEYS[2], ARGV[3], id)
redis.call('HSET', KEYS[3], id, ARGV[4])
return { id, body }
`;

const SETTLE_JOB = `
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
if ARGV[3] == 'retry' then
  redis.call('SET', KEYS[4], ARGV[4])
  redis.call('ZADD', KEYS[1], ARGV[5], ARGV[1])
else
  redis.call('DEL', KEYS[4])
  if ARGV[3] == 'failed' then redis.call('ZADD', KEYS[5], ARGV[5], ARGV[4]) end
end
return 1
`;

export class RedisJobQueue implements JobQueue {
  private readonly client: RedisClientType;
  private readonly due: string;
  private readonly processing: string;
  private readonly claims: string;
  private readonly jobPrefix: string;
  private connectPromise?: ReturnType<RedisClientType["connect"]>;

  constructor(private readonly redisUrl: string, private readonly scope = "zook:queue", disableOfflineQueue = false) {
    this.client = createClient({ url: this.redisUrl, disableOfflineQueue });
    this.client.on("error", () => { /* Command failures are reported by the caller. */ });
    this.due = scope + ":due";
    this.processing = scope + ":processing";
    this.claims = scope + ":claims";
    this.jobPrefix = scope + ":job:";
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
    const result = await this.client.eval(ENQUEUE_JOB, {
      keys: [this.jobPrefix + job.id, this.due, this.processing],
      arguments: [job.id, JSON.stringify(job), String(Date.parse(job.availableAt))],
    });
    return JSON.parse(String(result)) as QueueJob;
  }

  async processDueJobs(
    handler: (job: QueueJob) => Promise<void> | void,
    now = new Date(),
    limit = Infinity,
  ): Promise<void> {
    await this.ensureConnected();
    const nowMs = now.getTime();
    const keys = [this.due, this.processing, this.claims];
    await this.client.eval(RECOVER_JOBS, {
      keys,
      arguments: [String(nowMs), String(RECOVERY_BATCH), this.jobPrefix],
    });

    for (let processed = 0; processed < limit; processed++) {
      const token = randomId("claim");
      const delivery = await this.client.eval(CLAIM_JOB, {
        keys,
        arguments: [String(nowMs), this.jobPrefix, String(Math.max(nowMs, Date.now()) + PROCESSING_LEASE_MS), token],
      }) as [string, string] | [] | null;
      if (delivery === null) return;
      if (delivery.length === 0) continue;
      const [id, body] = delivery;
      const job = JSON.parse(body) as QueueJob;
      let disposition: "done" | "retry" | "failed" = "done";
      let score = Date.now();
      try {
        await handler(job);
      } catch (error) {
        if (error instanceof DeferJobError) {
          disposition = "retry";
          score = nowMs + error.delayMs;
        } else {
          job.attemptsMade++;
          job.failedReason = error instanceof Error ? error.message : "Unknown queue error";
          disposition = job.attemptsMade >= job.maxAttempts ? "failed" : "retry";
          if (disposition === "retry") score = nowMs + job.backoffMs * 2 ** (job.attemptsMade - 1);
        }
        if (disposition === "retry") job.availableAt = new Date(score).toISOString();
      }
      await this.client.eval(SETTLE_JOB, {
        keys: [...keys, this.jobPrefix + id, this.scope + ":dlq"],
        arguments: [id, token, disposition, JSON.stringify(job), String(score)],
      });
    }
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isOpen) return;
    this.connectPromise ??= this.client.connect().finally(() => {
      this.connectPromise = undefined;
    });
    await this.connectPromise;
  }
}

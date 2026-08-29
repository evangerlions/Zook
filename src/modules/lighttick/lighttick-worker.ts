import type { JobQueue } from "../../infrastructure/queue/job-queue.ts";
import type { QueueJob } from "../../shared/types.ts";
import { sha256 } from "../../shared/utils.ts";
import type { LightTickAiRunner } from "./ai/lighttick-ai-runner.ts";
import type { LightTickAiSceneName } from "./ai/lighttick-ai-scenes.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";

export const LIGHTTICK_JOB_NAMES = {
  aiRun: "lighttick.ai.run", notification: "lighttick.notification.schedule",
  aggregate: "lighttick.execution.aggregate", retry: "lighttick.ai.retry",
} as const;

export class LightTickJobService {
  constructor(private readonly queue: JobQueue, private readonly repository: LightTickRepository,
    private readonly clock = () => new Date()) {}

  async enqueueAiRun(owner: LightTickOwner, runId: string, scene: LightTickAiSceneName) {
    return await this.enqueueOnce(owner, `ai:${runId}`, LIGHTTICK_JOB_NAMES.aiRun, { app_id: owner.appId, user_id: owner.userId, run_id: runId, scene });
  }
  async enqueueReview(owner: LightTickOwner, runId: string, scene: "weekly_review" | "monthly_review") {
    return await this.enqueueAiRun(owner, runId, scene);
  }
  async enqueueNotification(owner: LightTickOwner, notificationKey: string, businessDate: string) {
    return await this.enqueueOnce(owner, `notification:${notificationKey}:${businessDate}`, LIGHTTICK_JOB_NAMES.notification,
      { app_id: owner.appId, user_id: owner.userId, notification_key: notificationKey, business_date: businessDate });
  }
  async enqueueAggregation(owner: LightTickOwner, businessDate: string) {
    return await this.enqueueOnce(owner, `aggregate:${businessDate}`, LIGHTTICK_JOB_NAMES.aggregate,
      { app_id: owner.appId, user_id: owner.userId, business_date: businessDate });
  }
  private async enqueueOnce(owner: LightTickOwner, operationId: string, name: string, payload: Record<string, unknown>) {
    const existing = await this.repository.getOperation(owner, operationId);
    if (existing) return existing.resultPayload;
    const job = await this.queue.add(name, payload, { attempts: 3, backoffMs: 1000 }); const now = this.clock().toISOString();
    const result = { job_id: job.id, name: job.name };
    await this.repository.saveOperation({ ...owner, operationId, deviceId: "worker", payloadHash: sha256(JSON.stringify(payload)),
      entityType: "job", entityId: job.id, action: "enqueue", requestPayload: payload, resultPayload: result,
      status: "accepted", createdAt: now, updatedAt: now });
    return result;
  }
}

export class LightTickWorker {
  constructor(private readonly aiRunner: LightTickAiRunner,
    private readonly recordTerminalFailure: (job: QueueJob, error: unknown) => Promise<void> = async () => undefined) {}

  async process(job: QueueJob): Promise<void> {
    try {
      if (job.name === LIGHTTICK_JOB_NAMES.aiRun || job.name === LIGHTTICK_JOB_NAMES.retry) {
        const owner: LightTickOwner = { appId: "lighttick", userId: String(job.payload.user_id) };
        await this.aiRunner.execute(owner, String(job.payload.run_id), String(job.payload.scene) as LightTickAiSceneName);
        return;
      }
      if ([LIGHTTICK_JOB_NAMES.notification, LIGHTTICK_JOB_NAMES.aggregate].includes(job.name as any)) return;
      throw new Error(`Unsupported LightTick job: ${job.name}`);
    } catch (error) {
      if (job.attemptsMade + 1 >= job.maxAttempts) await this.recordTerminalFailure(job, error);
      throw error;
    }
  }
}

export function nextLightTickLocalSchedule(now: Date, timezone: string, hour: number, minute = 0): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error("Schedule time is invalid.");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute); const addDays = currentMinutes < hour * 60 + minute ? 0 : 1;
  const targetLocal = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`); targetLocal.setUTCDate(targetLocal.getUTCDate() + addDays);
  const guess = new Date(targetLocal.getTime() + (hour * 60 + minute) * 60_000);
  const guessParts = Object.fromEntries(formatter.formatToParts(guess).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const observedUtcLike = Date.UTC(Number(guessParts.year), Number(guessParts.month) - 1, Number(guessParts.day), Number(guessParts.hour), Number(guessParts.minute));
  const desiredUtcLike = Date.UTC(targetLocal.getUTCFullYear(), targetLocal.getUTCMonth(), targetLocal.getUTCDate(), hour, minute);
  return new Date(guess.getTime() + desiredUtcLike - observedUtcLike);
}

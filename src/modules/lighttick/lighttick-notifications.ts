import type { JobQueue } from "../../infrastructure/queue/job-queue.ts";
import type { PushDispatcher } from "../../services/notification.service.ts";
import type { QueueJob } from "../../shared/types.ts";
import { randomId, sha256 } from "../../shared/utils.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";

export type LightTickNotificationType = "daily_tasks" | "unfinished_task" | "review_ready" | "recovery" | "plan_proposal";
export interface LightTickPushPayload { type: LightTickNotificationType; resource_id?: string; title_key: string; body_key: string; }
const allowedTypes = new Set<LightTickNotificationType>(["daily_tasks", "unfinished_task", "review_ready", "recovery", "plan_proposal"]);

export class LightTickNotificationService {
  constructor(private readonly repository: LightTickRepository, private readonly queue: JobQueue,
    private readonly dispatcher: PushDispatcher, private readonly recordEnqueueFailure: (payload: Record<string, unknown>, error: unknown) => Promise<void> = async () => undefined,
    private readonly clock = () => new Date()) {}

  async enqueue(owner: LightTickOwner, businessDate: string, payload: LightTickPushPayload) {
    if (!allowedTypes.has(payload.type) || !payload.title_key || !payload.body_key) throw new Error("LightTick push payload is invalid.");
    const operationId = `push:${payload.type}:${payload.resource_id ?? "none"}:${businessDate}`;
    const existing = await this.repository.getOperation(owner, operationId); if (existing) return existing.resultPayload;
    const jobPayload = { app_id: owner.appId, user_id: owner.userId, business_date: businessDate, notification: payload };
    try {
      const job = await this.queue.add("lighttick.notification.send", jobPayload, { attempts: 5, backoffMs: 1000 });
      const now = this.clock().toISOString(); const result = { job_id: job.id, queued: true };
      await this.repository.saveOperation({ ...owner, operationId, deviceId: "scheduler", payloadHash: sha256(JSON.stringify(jobPayload)),
        entityType: "notification", entityId: job.id, action: "enqueue", requestPayload: jobPayload, resultPayload: result,
        status: "accepted", createdAt: now, updatedAt: now }); return result;
    } catch (error) { await this.recordEnqueueFailure(jobPayload, error); return { queued: false }; }
  }

  async process(job: QueueJob) {
    if (job.name !== "lighttick.notification.send") return;
    const owner: LightTickOwner = { appId: "lighttick", userId: String(job.payload.user_id) };
    if (job.payload.app_id !== owner.appId) throw new Error("Cross-app LightTick notification rejected.");
    const profile = await this.repository.getProfile(owner); if (profile?.notificationPreferences.enabled === false) return;
    const notification = job.payload.notification as LightTickPushPayload;
    if (notification.type === "daily_tasks" || notification.type === "unfinished_task") {
      const goals = await this.repository.listGoals(owner);
      const target = notification.resource_id ? goals.find(goal => goal.id === notification.resource_id) : undefined;
      if (target?.status === "paused" || (!target && goals.length > 0 && goals.every(goal => goal.status === "paused"))) return;
    }
    if (profile && isQuietHour(this.clock(), profile.timezone, profile.notificationPreferences)) return;
    const devices = (await this.repository.listDevices(owner)).filter(device => device.active && device.notificationsEnabled);
    for (const device of devices) {
      try { await this.dispatcher.dispatch({ appId: owner.appId, userId: owner.userId, platform: device.platform,
        pushToken: device.pushToken, payload: job.payload.notification as any }); }
      catch (error) {
        if (/unregistered|invalid.token/i.test(error instanceof Error ? error.message : String(error))) {
          await this.repository.deleteDevice(owner, device.id, this.clock().toISOString()); continue;
        }
        throw error;
      }
    }
  }
}

function isQuietHour(now: Date, timezone: string, preferences: Record<string, unknown>) {
  const start = preferences.quiet_hours_start; const end = preferences.quiet_hours_end;
  if (typeof start !== "string" || typeof end !== "string") return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now); const value = `${parts.find(part => part.type === "hour")?.value}:${parts.find(part => part.type === "minute")?.value}`;
  return start <= end ? value >= start && value < end : value >= start || value < end;
}

export const LIGHTTICK_ANALYTICS_EVENTS = new Set(["lighttick_onboarding_completed", "lighttick_plan_confirmed",
  "lighttick_task_started", "lighttick_task_completed", "lighttick_task_skipped", "lighttick_task_deferred",
  "lighttick_review_viewed", "lighttick_proposal_accepted", "lighttick_sync_conflict", "lighttick_notification_failed"]);

export function lightTickAnalyticsPayload(event: string, input: Record<string, unknown>) {
  if (!LIGHTTICK_ANALYTICS_EVENTS.has(event)) throw new Error("LightTick analytics event is not allowlisted.");
  const denied = /token|prompt|note|coach|private|verification|secret|text/i;
  return Object.fromEntries(Object.entries(input).filter(([key]) => !denied.test(key)));
}

export function redactLightTickLog(input: Record<string, unknown>) {
  const denied = /authorization|access.?token|refresh.?token|push.?token|verification|provider.?key|prompt|note|coach|private/i;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, denied.test(key) ? "[REDACTED]" : value]));
}

import type { JobQueue } from "../../infrastructure/queue/job-queue.ts";
import type { PushDispatcher } from "../../services/notification.service.ts";
import type { QueueJob } from "../../shared/types.ts";
import { sha256 } from "../../shared/utils.ts";
import { businessDayOf } from "./growth/lighttick-growth.service.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import { businessDateAt } from "./lighttick-today.service.ts";
import type { LightTickOwner, LightTickTaskRow } from "./lighttick.types.ts";
import type { LightTickAnalyticsService } from "./lighttick-analytics.ts";

export type LightTickNotificationType = "daily_tasks" | "unfinished_task" | "review_ready" | "recovery" | "plan_proposal" | "course_reminder";
export interface LightTickPushPayload {
  type: LightTickNotificationType;
  resource_id?: string;
  expected_task_version?: number;
  title_key: string;
  body_key: string;
}
const allowedTypes = new Set<LightTickNotificationType>(["daily_tasks", "unfinished_task", "review_ready", "recovery", "plan_proposal", "course_reminder"]);
type CourseReminderCoverage = (owner: LightTickOwner, task: LightTickTaskRow) => Promise<boolean>;
type NotificationRepository = Pick<LightTickRepository, "transaction" | "getOperation" | "saveOperation" |
  "getProfile" | "getGoal" | "listGoals" | "getTask" | "getPlan" | "listReviews" | "getProposal" |
  "listDevices" | "deleteDevice">;

function isTaskVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export class LightTickNotificationService {
  constructor(private readonly repository: NotificationRepository, private readonly queue: JobQueue,
    private readonly dispatcher: PushDispatcher, private readonly recordEnqueueFailure: (payload: Record<string, unknown>, error: unknown) => Promise<void> = async () => undefined,
    private readonly clock = () => new Date(), private readonly analytics?: LightTickAnalyticsService,
    private readonly canDeliverCourseReminder?: CourseReminderCoverage) {}

  async enqueue(owner: LightTickOwner, businessDate: string, payload: LightTickPushPayload) {
    if (!allowedTypes.has(payload.type) || !payload.title_key || !payload.body_key) throw new Error("LightTick push payload is invalid.");
    const isCourse = payload.type === "course_reminder";
    if (isCourse && (!payload.resource_id?.trim() || !isTaskVersion(payload.expected_task_version)))
      throw new Error("LightTick course reminder requires a task and its expected version.");
    const version = isCourse ? `:${payload.expected_task_version}` : "";
    const operationId = `push:${payload.type}:${payload.resource_id ?? "none"}:${businessDate}${version}`;
    const existing = await this.repository.getOperation(owner, operationId); if (existing) return existing.resultPayload;
    const jobPayload = { app_id: owner.appId, user_id: owner.userId, business_date: businessDate, notification: payload };
    try {
      const job = await this.queue.add("lighttick.notification.send", jobPayload, { attempts: 5, backoffMs: 1000,
        jobId: `lighttick_push_${sha256(`${owner.appId}:${owner.userId}:${operationId}`).slice(0, 32)}` });
      const now = this.clock().toISOString(); const result = { job_id: job.id, queued: true };
      await this.repository.saveOperation({ ...owner, operationId, deviceId: "scheduler", payloadHash: sha256(JSON.stringify(jobPayload)),
        entityType: "notification", entityId: job.id, action: "enqueue", requestPayload: jobPayload, resultPayload: result,
        status: "accepted", createdAt: now, updatedAt: now });
      await this.record(owner, "lighttick_notification_queued", operationId, payload.type, { delivery_state: "queued", business_date: businessDate });
      return result;
    } catch (error) {
      await this.recordEnqueueFailure(jobPayload, error);
      await this.record(owner, "lighttick_notification_failed", operationId, payload.type, { delivery_state: "enqueue_failed", business_date: businessDate });
      return { queued: false };
    }
  }

  async schedule(job: QueueJob) {
    if (job.name !== "lighttick.notification.schedule") return;
    if (job.payload.app_id !== "lighttick") throw new Error("Cross-app LightTick notification rejected.");
    const type = String(job.payload.notification_key) as LightTickNotificationType;
    if (!allowedTypes.has(type)) throw new Error("LightTick notification key is invalid.");
    const copy = defaultCopy(type);
    const payload: LightTickPushPayload = { type, title_key: copy.titleKey, body_key: copy.bodyKey };
    if (type === "course_reminder") {
      const { resource_id, expected_task_version } = job.payload;
      if (typeof resource_id !== "string" || !isTaskVersion(expected_task_version))
        throw new Error("LightTick course reminder requires a task and its expected version.");
      payload.resource_id = resource_id;
      payload.expected_task_version = expected_task_version;
    }
    return await this.enqueue({ appId: "lighttick", userId: String(job.payload.user_id) },
      String(job.payload.business_date), payload);
  }

  async process(job: QueueJob) {
    if (job.name !== "lighttick.notification.send") return;
    const owner: LightTickOwner = { appId: "lighttick", userId: String(job.payload.user_id) };
    if (job.payload.app_id !== owner.appId) throw new Error("Cross-app LightTick notification rejected.");
    const notification = job.payload.notification as LightTickPushPayload;
    const businessDate = String(job.payload.business_date);
    const reason = notification.type === "course_reminder"
      ? await this.courseReminderSuppression(owner, notification, businessDate)
      : await this.notificationSuppression(owner, notification);
    if (reason) return await this.suppress(owner, job, reason);
    const devices = (await this.repository.listDevices(owner)).filter(device => device.active && device.notificationsEnabled);
    if (devices.length === 0) return await this.suppress(owner, job, "no_device");
    const copy = defaultCopy(notification.type);
    for (const device of devices) {
      const reminderReceiptId = notification.type === "course_reminder"
        ? `push:course_reminder_delivery:${sha256(JSON.stringify([notification.resource_id, businessDate, device.id]))}`
        : undefined;
      if (reminderReceiptId && await this.repository.getOperation(owner, reminderReceiptId)) continue;
      let tokenInvalidated = false;
      const invalidateToken = async () => {
        await this.repository.deleteDevice(owner, device.id, this.clock().toISOString());
        tokenInvalidated = true;
      };
      try {
        await this.dispatcher.dispatch({ appId: owner.appId, userId: owner.userId, platform: device.platform,
          pushToken: device.pushToken, payload: { app: "lighttick", type: notification.type,
            entityId: notification.resource_id, title: copy.title, body: copy.body,
            data: { type: notification.type, sync: "true",
              ...(notification.type === "course_reminder" ? {
                recipient_scope: sha256(`${owner.appId}:${owner.userId}`),
                business_date: businessDate,
                task_version: String(notification.expected_task_version),
              } : {}),
              ...(notification.resource_id ? { resource_id: notification.resource_id } : {}) } },
          invalidateToken });
      } catch (error) {
        if (!tokenInvalidated && /unregistered|invalid.token/i.test(error instanceof Error ? error.message : String(error))) {
          await invalidateToken();
        }
        if (!tokenInvalidated) {
          await this.record(owner, "lighttick_notification_failed", `${job.id}:${device.id}`, notification.type,
            { delivery_state: "retryable", provider: device.pushProvider, reason_code: "provider_error", retry_count: job.attemptsMade });
          throw error;
        }
      }
      if (tokenInvalidated) {
        await this.record(owner, "lighttick_notification_failed", `${job.id}:${device.id}`, notification.type,
          { delivery_state: "invalid_token", provider: device.pushProvider, reason_code: "invalid_token" });
        continue;
      }
      if (reminderReceiptId && notification.resource_id) {
        const requestPayload = { business_date: businessDate, expected_task_version: notification.expected_task_version };
        const acceptedAt = this.clock().toISOString();
        await this.repository.saveOperation({
          ...owner, operationId: reminderReceiptId, deviceId: device.id, entityType: "notification",
          entityId: notification.resource_id, action: "course_reminder_delivery", payloadHash: sha256(JSON.stringify(requestPayload)),
          requestPayload, resultPayload: { provider_accepted: true }, status: "accepted", createdAt: acceptedAt, updatedAt: acceptedAt,
        });
      }
      await this.record(owner, "lighttick_notification_delivered", `${job.id}:${device.id}`, notification.type,
        { delivery_state: "delivered", provider: device.pushProvider, device_count: devices.length });
    }
  }

  private async notificationSuppression(owner: LightTickOwner, notification: LightTickPushPayload) {
    const profile = await this.repository.getProfile(owner);
    if (profile?.notificationPreferences.enabled === false) return "disabled";
    if (notification.type === "review_ready" && profile?.notificationPreferences.review_reminders === false) return "review_disabled";
    const goals = await this.repository.listGoals(owner);
    let target = notification.resource_id ? goals.find(goal => goal.id === notification.resource_id) : undefined;
    if (!target && notification.resource_id) {
      const task = await this.repository.getTask(owner, notification.resource_id);
      const plan = task ? undefined : await this.repository.getPlan(owner, notification.resource_id);
      const review = !task && !plan ? (await this.repository.listReviews(owner)).find(r => r.id === notification.resource_id) : undefined;
      const proposal = !task && !plan && !review ? await this.repository.getProposal(owner, notification.resource_id) : undefined;
      const proposalPlan = proposal ? await this.repository.getPlan(owner, proposal.planId) : undefined;
      target = goals.find(g => g.id === (task?.goalId ?? plan?.goalId ?? review?.goalId ?? proposalPlan?.goalId));
    }
    if (target && ["paused", "completed", "archived"].includes(target.status) || !target && goals.length > 0 && goals.every(g => ["paused", "completed", "archived"].includes(g.status)))
      return "goal_stopped";
    if (profile && isQuietHour(this.clock(), profile.timezone, profile.notificationPreferences)) return "quiet_hours";
  }

  private async courseReminderSuppression(owner: LightTickOwner, notification: LightTickPushPayload, businessDate: string) {
    return this.repository.transaction(owner, async () => {
      const profile = await this.repository.getProfile(owner);
      if (profile?.notificationPreferences.enabled !== true) return "disabled";
      const now = this.clock();
      if (businessDateAt(now, profile.timezone) !== businessDate || !notification.resource_id ||
          !isTaskVersion(notification.expected_task_version)) return "stale_course_reminder";
      const task = await this.repository.getTask(owner, notification.resource_id);
      if (!task?.lessonSource || task.version !== notification.expected_task_version ||
          (task.status !== "pending" && task.status !== "in_progress") ||
          businessDayOf(task.scheduledFor, profile.timezone) !== businessDate) return "stale_course_reminder";
      const plan = await this.repository.getPlan(owner, task.planId);
      const goal = await this.repository.getGoal(owner, task.goalId);
      if (plan?.status !== "active" || plan.goalId !== task.goalId || goal?.status !== "active") return "goal_stopped";
      if (isQuietHour(now, profile.timezone, profile.notificationPreferences)) return "quiet_hours";
      if (!await this.canDeliverCourseReminder?.(owner, task)) return "course_unavailable";
    });
  }

  private async suppress(owner: LightTickOwner, job: QueueJob, reason: string) {
    const notification = job.payload.notification as LightTickPushPayload;
    await this.record(owner, "lighttick_notification_suppressed", job.id, notification.type,
      { delivery_state: "suppressed", reason_code: reason });
  }

  private async record(owner: LightTickOwner, event: "lighttick_notification_queued" | "lighttick_notification_delivered" |
    "lighttick_notification_suppressed" | "lighttick_notification_failed", dedupeKey: string, type: LightTickNotificationType,
    metadata: Record<string, unknown>) {
    try { await this.analytics?.record({ userId: owner.userId, event, dedupeKey, pageKey: "notification",
      metadata: { ...metadata, notification_type: type } }); } catch { /* Delivery is independent of ordinary analytics. */ }
  }
}

function defaultCopy(type: LightTickNotificationType) {
  switch (type) {
    case "daily_tasks": return { titleKey: "daily.title", bodyKey: "daily.body", title: "今天先推进这一件", body: "打开 LightTick 查看今天的小行动。" };
    case "unfinished_task": return { titleKey: "unfinished.title", bodyKey: "unfinished.body", title: "今天还可以轻轻推进", body: "回到 LightTick 完成或调整今天的任务。" };
    case "course_reminder": return { titleKey: "course_reminder.title", bodyKey: "course_reminder.body", title: "今天有一节课", body: "打开 LightTick 查看你安排的课程。" };
    case "review_ready": return { titleKey: "review.title", bodyKey: "review.body", title: "本周复盘已准备好", body: "查看结论和下一步建议。" };
    case "recovery": return { titleKey: "recovery.title", bodyKey: "recovery.body", title: "可以从更小一步重新开始", body: "LightTick 已准备好恢复建议。" };
    case "plan_proposal": return { titleKey: "proposal.title", bodyKey: "proposal.body", title: "计划调整建议已准备好", body: "确认后才会更新你的计划。" };
  }
}

function isQuietHour(now: Date, timezone: string, preferences: Record<string, unknown>) {
  const start = preferences.quiet_hours_start; const end = preferences.quiet_hours_end;
  if (typeof start !== "string" || typeof end !== "string") return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now); const value = `${parts.find(part => part.type === "hour")?.value}:${parts.find(part => part.type === "minute")?.value}`;
  return start <= end ? value >= start && value < end : value >= start || value < end;
}

export function redactLightTickLog(input: Record<string, unknown>) {
  const denied = /authorization|access.?token|refresh.?token|push.?token|verification|provider.?key|prompt|note|coach|private/i;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, denied.test(key) ? "[REDACTED]" : value]));
}

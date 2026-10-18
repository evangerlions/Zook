import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { NotificationService } from "../../../services/notification.service.ts";
import { ApplicationError, badRequest, conflict } from "../../../shared/errors.ts";
export interface FrogSleepAdminRetryCommand { id: string; adminUser: string; reason: unknown; requestId?: string }
/** Requeues only known failed Push deliveries under the original job lock, with an administrator audit. */
export async function retryFrogSleepAdminNotification(database: ApplicationDatabase, notificationService: NotificationService, command: FrogSleepAdminRetryCommand) {
  const { id, adminUser, reason, requestId } = command;
  return database.withFrogSleepNotificationLock(`job:${id}`, async () => {
    const job = await database.findNotificationJob(id);
    if (!job || job.appId !== "frogsleep") throw new ApplicationError(404, "FROGSLEEP_JOB_NOT_FOUND", "Notification was not found.");
    if (job.channel !== "push") conflict("FROGSLEEP_RETRY_NOT_ALLOWED", "Only Push jobs are supported by this operation.");
    if (job.status === "QUEUED") return { notification_job_id: id, queued: true, replayed: true };
    const delivery = job.payload._frogsleep_delivery as { devices?: Record<string, string>; outcome?: string } | undefined;
    if (job.status === "SENT" || job.retryCount >= 5 || Object.values(delivery?.devices ?? {}).some(d => ["outcome_unknown", "processing"].includes(d))) {
      conflict("FROGSLEEP_RETRY_NOT_ALLOWED", "Terminal or uncertain deliveries cannot be retried.");
    }
    if (!["FAILED", "ENQUEUE_FAILED"].includes(job.status)) conflict("FROGSLEEP_RETRY_NOT_ALLOWED", "Only failed deliveries can be retried.");
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) badRequest("REQ_INVALID_BODY", "A retry reason is required (max 500 characters).");
    await database.insertAuditLog({ id: crypto.randomUUID(), appId: "frogsleep", actorUserId: adminUser,
      action: "frogsleep.notifications.retry", resourceType: "notification_job", resourceId: id,
      payload: { reason: reason.trim(), requestId: requestId }, createdAt: new Date().toISOString() });
    return notificationService.requeueFrogSleepNotification(id);
  });
}


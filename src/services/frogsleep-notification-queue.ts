import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";
import type { NotificationJobRecord } from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";

export type FrogSleepNotificationCommand = Omit<NotificationJobRecord, "id" | "status" | "retryCount"> & { deduplicationKey?: string };

/** Uses a stable logical job and one recovery event; queue duplicates replay the same durable job. */
export async function queueFrogSleepNotification(database: ApplicationDatabase, queue: JobQueue, command: FrogSleepNotificationCommand) {
  const id = command.deduplicationKey ? `notification_${createHash("sha256").update(JSON.stringify([
    command.appId, command.recipientUserId, command.channel, command.deduplicationKey])).digest("hex")}` : randomId("notification");
  return await database.withFrogSleepNotificationLock(`job:${id}`, async () => {
    const existing = await database.findNotificationJob(id);
    if (existing && existing.retryCount >= 5 && existing.status !== "SENT") return { queued: false, notificationJobId: id };
    if (existing && ["SENT", "QUEUED"].includes(existing.status)) return { queued: true, notificationJobId: id };
    if (!existing) await database.insertNotificationJob({ id, appId: command.appId, recipientUserId: command.recipientUserId,
      channel: command.channel, payload: command.payload, status: "PENDING", retryCount: 0 });
    try {
      await queue.add("notification.send", { notificationJobId: id, channel: command.channel }, { attempts: 5, backoffMs: 1000, jobId: id });
      await database.updateNotificationJob(id, { status: "QUEUED" });
      return { queued: true, notificationJobId: id };
    } catch (error) {
      await database.updateNotificationJob(id, { status: "ENQUEUE_FAILED" });
      await saveFrogSleepNotificationFailure(database, id, error);
      return { queued: false, notificationJobId: id };
    }
  });
}

/** Keeps exactly one due-replay entry per original notification job while under its delivery lock. */
export async function saveFrogSleepNotificationFailure(database: ApplicationDatabase, id: string, error: unknown) {
  if ((await database.listFailedEvents("frogsleep")).some(value => value.eventType === "notification.send" && value.payload.notificationJobId === id)) return;
  await database.insertFailedEvent({ id: randomId("failed_event"), appId: "frogsleep", eventType: "notification.send",
    payload: { notificationJobId: id }, errorMessage: error instanceof Error ? error.message : "Push dispatch failed",
    retryCount: 0, nextRetryAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() });
}

export async function clearFrogSleepNotificationFailures(database: ApplicationDatabase, id: string) {
  for (const entry of await database.listFailedEvents("frogsleep")) if (entry.eventType === "notification.send" && entry.payload.notificationJobId === id) await database.deleteFailedEvent(entry.id);
}

/** Enqueues the same failed job; callers hold its lock and validate administrator retry policy. */
export async function enqueueExistingFrogSleepNotification(database: ApplicationDatabase, queue: JobQueue, id: string) {
  const job = await database.findNotificationJob(id);
  if (!job || job.appId !== "frogsleep") throw new Error("FrogSleep notification was not found");
  try {
    await queue.add("notification.send", { notificationJobId: id, channel: job.channel }, { attempts: 5, backoffMs: 1000, jobId: id });
    await database.updateNotificationJob(id, { status: "QUEUED" });
    await clearFrogSleepNotificationFailures(database, id);
    return { queued: true, notificationJobId: id };
  } catch (error) {
    await database.updateNotificationJob(id, { status: "ENQUEUE_FAILED" });
    await saveFrogSleepNotificationFailure(database, id, error);
    return { queued: false, notificationJobId: id };
  }
}

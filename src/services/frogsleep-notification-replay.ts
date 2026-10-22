import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";
import type { FailedEventRecord } from "../shared/types.ts";

/** Replays the original job once across concurrent retry workers without replacing its delivery receipts. */
export async function replayFrogSleepNotificationFailure(database: ApplicationDatabase, queue: JobQueue, entry: FailedEventRecord, now: Date) {
  const id = String(entry.payload.notificationJobId ?? "");
  return await database.withFrogSleepNotificationLock(`job:${id}`, async () => {
    const current = (await database.listFailedEvents("frogsleep")).find(value => value.id === entry.id);
    if (!current || Date.parse(current.nextRetryAt) > now.getTime()) return false;
    const job = await database.findNotificationJob(id);
    if (!job || job.status === "SENT" || job.retryCount >= 5) { await database.deleteFailedEvent(entry.id); return false; }
    await queue.add("notification.send", { notificationJobId: id, channel: job.channel }, { attempts: 5, backoffMs: 1000, jobId: id });
    await database.deleteFailedEvent(entry.id);
    return true;
  });
}

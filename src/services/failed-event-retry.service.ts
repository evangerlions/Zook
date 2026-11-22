import { replayFrogSleepNotificationFailure } from "./frogsleep-notification-replay.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";

/**
 * FailedEventRetryService replays due failed_events back into the queue every retry window.
 */
export class FailedEventRetryService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly queue: JobQueue,
    private readonly logger: StructuredLogger,
  ) {}

  async retryDueEvents(now = new Date()): Promise<{ replayed: number; remaining: number }> {
    const dueEvents = (await this.database.listFailedEvents()).filter(
      (item) => new Date(item.nextRetryAt) <= now,
    );

    let replayed = 0;

    for (const failedEvent of dueEvents) {
      try {
        if (failedEvent.appId === "frogsleep" && failedEvent.eventType === "notification.send") {
          if (await replayFrogSleepNotificationFailure(this.database, this.queue, failedEvent, now)) replayed += 1;
          continue;
        }
        const notificationJobId = failedEvent.payload.notificationJobId;
        await this.queue.add(failedEvent.eventType, failedEvent.payload, {
          attempts: 5,
          backoffMs: 1000,
          jobId: failedEvent.eventType === "notification.send" && typeof notificationJobId === "string"
            ? notificationJobId : failedEvent.id,
        });

        await this.database.deleteFailedEvent(failedEvent.id);
        replayed += 1;
      } catch (error) {
        const delayMinutes = 2 ** Math.min(failedEvent.retryCount, 6);
        const nextRetryAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
        const errorMessage = error instanceof Error ? error.message : "Retry enqueue failed";
        await this.database.updateFailedEvent(failedEvent.id, {
          retryCount: failedEvent.retryCount + 1,
          errorMessage,
          nextRetryAt,
        });

        this.logger.warn("failed event replay delayed", {
          appId: failedEvent.appId,
          jobId: failedEvent.id,
          jobName: failedEvent.eventType,
          error: errorMessage,
        });
      }
    }

    return {
      replayed,
      remaining: (await this.database.listFailedEvents()).length,
    };
  }
}

import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";

/**
 * FailedEventRetryService replays due failed_events back into the queue every retry window.
 */
export class FailedEventRetryService {
  private readonly maxRetryCount = 10;

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
        await this.queue.add(failedEvent.eventType, failedEvent.payload, {
          attempts: 5,
          backoffMs: 1000,
        });

        await this.database.deleteFailedEvent(failedEvent.id);
        replayed += 1;
      } catch (error) {
        const nextRetryAt = new Date(now.getTime() + 60 * 1000).toISOString();
        const errorMessage = error instanceof Error ? error.message : "Retry enqueue failed";
        const nextRetryCount = failedEvent.retryCount + 1;

        if (nextRetryCount >= this.maxRetryCount) {
          await this.database.deleteFailedEvent(failedEvent.id);
          this.logger.error("failed event retry exceeded max attempts, dropping event", {
            appId: failedEvent.appId,
            jobId: failedEvent.id,
            jobName: failedEvent.eventType,
            error: errorMessage,
            retryCount: nextRetryCount,
          });
          continue;
        }

        await this.database.updateFailedEvent(failedEvent.id, {
          retryCount: nextRetryCount,
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

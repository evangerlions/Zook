import { InMemoryDatabase } from "../infrastructure/database/prisma/in-memory-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";

/**
 * FailedEventRetryService replays due failed_events back into the queue every retry window.
 */
export class FailedEventRetryService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly queue: JobQueue,
    private readonly logger: StructuredLogger,
  ) {}

  async retryDueEvents(now = new Date()): Promise<{ replayed: number; remaining: number }> {
    const dueEvents = this.database.failedEvents.filter(
      (item) => new Date(item.nextRetryAt) <= now,
    );

    let replayed = 0;

    for (const failedEvent of dueEvents) {
      try {
        await this.queue.add(failedEvent.eventType, failedEvent.payload, {
          attempts: 5,
          backoffMs: 1000,
        });

        this.database.failedEvents = this.database.failedEvents.filter(
          (item) => item.id !== failedEvent.id,
        );
        replayed += 1;
      } catch (error) {
        failedEvent.retryCount += 1;
        failedEvent.errorMessage = error instanceof Error ? error.message : "Retry enqueue failed";
        failedEvent.nextRetryAt = new Date(now.getTime() + 60 * 1000).toISOString();

        this.logger.warn("failed event replay delayed", {
          appId: failedEvent.appId,
          jobId: failedEvent.id,
          jobName: failedEvent.eventType,
          error: failedEvent.errorMessage,
        });
      }
    }

    return {
      replayed,
      remaining: this.database.failedEvents.length,
    };
  }
}

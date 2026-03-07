import { InMemoryDatabase } from "../infrastructure/database/prisma/in-memory-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "../infrastructure/queue/bullmq/in-memory-queue.ts";
import { randomId } from "../shared/utils.ts";

/**
 * NotificationService sends work to the queue and falls back to failed_events when enqueueing fails.
 */
export class NotificationService {
  constructor(
    private readonly database: InMemoryDatabase,
    private readonly queue: InMemoryJobQueue,
    private readonly logger: StructuredLogger,
  ) {}

  queueNotification(command: {
    appId: string;
    recipientUserId: string;
    channel: "email" | "sms" | "push";
    payload: Record<string, unknown>;
  }): { queued: boolean; notificationJobId: string } {
    const notificationJobId = randomId("notification");
    this.database.notificationJobs.push({
      id: notificationJobId,
      appId: command.appId,
      recipientUserId: command.recipientUserId,
      channel: command.channel,
      payload: command.payload,
      status: "PENDING",
      retryCount: 0,
    });

    try {
      this.queue.add(
        "notification.send",
        {
          notificationJobId,
          channel: command.channel,
        },
        { attempts: 5, backoffMs: 1000 },
      );

      const job = this.database.notificationJobs.find((item) => item.id === notificationJobId);
      if (job) {
        job.status = "QUEUED";
      }

      return {
        queued: true,
        notificationJobId,
      };
    } catch (error) {
      const job = this.database.notificationJobs.find((item) => item.id === notificationJobId);
      if (job) {
        job.status = "ENQUEUE_FAILED";
      }

      this.database.failedEvents.push({
        id: randomId("failed_event"),
        appId: command.appId,
        eventType: "notification.send",
        payload: {
          notificationJobId,
          ...command,
        },
        errorMessage: error instanceof Error ? error.message : "Queue add failed",
        retryCount: 0,
        nextRetryAt: new Date(Date.now() + 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      this.logger.error("notification enqueue failed", {
        appId: command.appId,
        jobId: notificationJobId,
        jobName: "notification.send",
        error: error instanceof Error ? error.message : "Queue add failed",
      });

      return {
        queued: false,
        notificationJobId,
      };
    }
  }

  async processQueueJob(job: { id: string; name: string; payload: Record<string, unknown> }): Promise<void> {
    if (job.name !== "notification.send") {
      return;
    }

    const notificationJobId = String(job.payload.notificationJobId ?? "");
    const record = this.database.notificationJobs.find((item) => item.id === notificationJobId);
    if (!record) {
      return;
    }

    record.status = "SENT";
    record.retryCount += 1;
    this.logger.info("notification delivered", {
      appId: record.appId,
      jobId: job.id,
      jobName: job.name,
      userId: record.recipientUserId,
    });
  }
}

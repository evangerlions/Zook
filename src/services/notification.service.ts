import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";
import { randomId } from "../shared/utils.ts";

/**
 * NotificationService sends work to the queue and falls back to failed_events when enqueueing fails.
 */
export class NotificationService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly queue: JobQueue,
    private readonly logger: StructuredLogger,
  ) {}

  async queueNotification(command: {
    appId: string;
    recipientUserId: string;
    channel: "email" | "sms" | "push";
    payload: Record<string, unknown>;
  }): Promise<{ queued: boolean; notificationJobId: string }> {
    const notificationJobId = randomId("notification");
    return await this.database.withExclusiveSession(async () => {
      await this.database.insertNotificationJob({
        id: notificationJobId,
        appId: command.appId,
        recipientUserId: command.recipientUserId,
        channel: command.channel,
        payload: command.payload,
        status: "PENDING",
        retryCount: 0,
      });

      try {
        await this.queue.add(
          "notification.send",
          {
            notificationJobId,
            channel: command.channel,
          },
          { attempts: 5, backoffMs: 1000 },
        );

        await this.database.updateNotificationJob(notificationJobId, {
          status: "QUEUED",
        });

        return {
          queued: true,
          notificationJobId,
        };
      } catch (error) {
        await this.database.updateNotificationJob(notificationJobId, {
          status: "ENQUEUE_FAILED",
        });

        try {
          await this.database.insertFailedEvent({
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
        } catch (failedEventError) {
          this.logger.error("failed to persist failed notification enqueue event", {
            appId: command.appId,
            jobId: notificationJobId,
            jobName: "notification.send",
            error: failedEventError instanceof Error ? failedEventError.message : "Failed event insert failed",
          });
        }

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
    });
  }

  async processQueueJob(job: { id: string; name: string; payload: Record<string, unknown> }): Promise<void> {
    if (job.name !== "notification.send") {
      return;
    }

    const notificationJobId = String(job.payload.notificationJobId ?? "");
    const record = await this.database.findNotificationJob(notificationJobId);
    if (!record) {
      return;
    }

    if (record.status === "SENT") {
      return;
    }

    if (record.status === "ENQUEUE_FAILED") {
      this.logger.warn("notification skipped due to enqueue failure", {
        appId: record.appId,
        jobId: job.id,
        jobName: job.name,
        notificationJobId,
      });
      return;
    }

    await this.database.updateNotificationJob(notificationJobId, {
      status: "SENT",
      retryCount: record.retryCount + 1,
    });
    this.logger.info("notification delivered", {
      appId: record.appId,
      jobId: job.id,
      jobName: job.name,
      userId: record.recipientUserId,
    });
  }
}

import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { JobQueue } from "../infrastructure/queue/job-queue.ts";
import type { NotificationQueueResult } from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../modules/frogsleep/frogsleep-app.ts";
import type { FrogSleepNotificationPayload } from "../modules/frogsleep/frogsleep-notifications.ts";

export interface PushDispatchRequest {
  appId: string;
  userId: string;
  platform: string;
  pushToken: string;
  payload: FrogSleepNotificationPayload;
}

export interface PushDispatcher {
  dispatch(request: PushDispatchRequest): Promise<void>;
}

class LoggingPushDispatcher implements PushDispatcher {
  constructor(private readonly logger: StructuredLogger) {}

  async dispatch(request: PushDispatchRequest): Promise<void> {
    this.logger.info("push notification dispatched", {
      appId: request.appId,
      userId: request.userId,
      platform: request.platform,
      notificationType: request.payload.type,
    });
  }
}

/**
 * NotificationService sends work to the queue and falls back to failed_events when enqueueing fails.
 */
export class NotificationService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly queue: JobQueue,
    private readonly logger: StructuredLogger,
    private readonly pushDispatcher: PushDispatcher = new LoggingPushDispatcher(logger),
  ) {}

  async dispatchPush(request: PushDispatchRequest): Promise<void> {
    await this.pushDispatcher.dispatch(request);
  }

  async queueNotification(command: {
    appId: string;
    recipientUserId: string;
    channel: "email" | "sms" | "push";
    payload: Record<string, unknown>;
  }): Promise<NotificationQueueResult> {
    const notificationJobId = randomId("notification");
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
    const record = await this.database.findNotificationJob(notificationJobId);
    if (!record) {
      return;
    }

    if (record.appId === FROGSLEEP_APP_ID && record.channel === "push") {
      await this.processFrogSleepPushJob(job, record);
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

  private async processFrogSleepPushJob(
    job: { id: string; name: string; payload: Record<string, unknown> },
    record: {
      id: string;
      appId: string;
      recipientUserId: string;
      payload: Record<string, unknown>;
      retryCount: number;
    },
  ): Promise<void> {
    const payload = record.payload as unknown as FrogSleepNotificationPayload;
    const devices = await this.database.listFrogSleepDevices({
      appId: record.appId,
      userId: record.recipientUserId,
      pushEnabled: true,
    });

    if (devices.length === 0) {
      await this.database.updateNotificationJob(record.id, {
        status: "SENT",
        retryCount: record.retryCount + 1,
      });
      this.logger.info("frogsleep push skipped without active devices", {
        appId: record.appId,
        jobId: job.id,
        jobName: job.name,
        userId: record.recipientUserId,
      });
      return;
    }

    try {
      for (const device of devices) {
        await this.pushDispatcher.dispatch({
          appId: record.appId,
          userId: record.recipientUserId,
          platform: device.platform,
          pushToken: device.pushToken,
          payload,
        });
      }
      await this.database.updateNotificationJob(record.id, {
        status: "SENT",
        retryCount: record.retryCount + 1,
      });
    } catch (error) {
      await this.database.updateNotificationJob(record.id, {
        status: "FAILED",
        retryCount: record.retryCount + 1,
      });
      await this.database.insertFailedEvent({
        id: randomId("failed_event"),
        appId: record.appId,
        eventType: "notification.send",
        payload: {
          notificationJobId: record.id,
          jobPayload: job.payload,
        },
        errorMessage: error instanceof Error ? error.message : "Push dispatch failed",
        retryCount: 0,
        nextRetryAt: new Date(Date.now() + 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
    }
  }
}

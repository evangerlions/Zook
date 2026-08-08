import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import type { JobQueue } from "./infrastructure/queue/job-queue.ts";
import { BuddyInvitationEmailWorkerService } from "./modules/frogsleep/buddy-growth/buddy-invitation-email-worker.service.ts";
import { createBuddyInvitationEmailWorker } from "./modules/frogsleep/buddy-growth/buddy-invitation-email-worker.factory.ts";
import { BuddyMilestoneReportService } from "./modules/frogsleep/buddy-growth/buddy-milestone-report.service.ts";
import { BuddyNotificationWorkerService } from "./modules/frogsleep/buddy-growth/buddy-notification-worker.service.ts";
import type { CommonEmailConfigService } from "./services/common-email-config.service.ts";
import { FailedEventRetryService } from "./services/failed-event-retry.service.ts";
import { NotificationService } from "./services/notification.service.ts";
import { createPushDispatcher } from "./services/push-dispatcher-factory.ts";
import type { RegistrationEmailSender } from "./services/tencent-ses-registration-email.service.ts";

interface FrogSleepWorkerDependencies {
  database: ApplicationDatabase;
  queue: JobQueue;
  logger: StructuredLogger;
  commonEmailConfigService: CommonEmailConfigService;
  registrationEmailSender: RegistrationEmailSender;
}

/// Creates FrogSleep notification and invitation workers in one ordered runtime bundle.
export function createFrogSleepWorkerServices(dependencies: FrogSleepWorkerDependencies) {
  const { database, queue, logger, commonEmailConfigService, registrationEmailSender } = dependencies;
  const pushDispatcher = createPushDispatcher({ database, logger });
  const notificationService = new NotificationService(database, queue, logger, pushDispatcher);
  return {
    notificationService,
    buddyNotificationWorkerService: new BuddyNotificationWorkerService(database, notificationService),
    buddyInvitationEmailWorkerService: createBuddyInvitationEmailWorker(
      database,
      commonEmailConfigService,
      registrationEmailSender,
    ) as BuddyInvitationEmailWorkerService,
    buddyMilestoneReportService: new BuddyMilestoneReportService(database),
    failedEventRetryService: new FailedEventRetryService(database, queue, logger),
  };
}

import { init } from "./infrastructure/runtime/init.ts";
import { WorkerTickLogThrottle } from "./services/worker-tick-log-throttle.ts";
import { resolveBuddyGrowthCapabilities } from "./modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";

/**
 * The worker entry mirrors the BullMQ worker deployment shape from the design document.
 * It now consumes the shared Redis-backed job queue used by the API runtime.
 */
const runtime = await init({
  serviceName: "worker",
  emitLogs: true,
});
const workerTickLogThrottle = new WorkerTickLogThrottle();
const buddyCapabilities = resolveBuddyGrowthCapabilities();

async function runTick(): Promise<void> {
  await runtime.database.withExclusiveSession(async () => {
    const replay = await runtime.services.failedEventRetryService.retryDueEvents();
    const smsCleanup = await runtime.services.smsVerificationCleanupService.runDailyCleanupIfDue();
    const llmCleanup = await runtime.services.llmObservabilityRetentionService.runDailyCleanupIfDue();
    await runtime.queue.processDueJobs(async (job) => {
      if (job.name.startsWith("lighttick.")) {
        if (job.name === "lighttick.notification.send") await runtime.services.lighttickRuntime.notifications?.process(job);
        else await runtime.services.lighttickRuntime.worker?.process(job);
        return;
      }
      await runtime.services.notificationService.processQueueJob(job);
    });
    const buddyNotifications = await runtime.services.buddyNotificationWorkerService.processBatch();
    const buddyInvitationEmails = buddyCapabilities.explicitInviteConsent && buddyCapabilities.emailDelivery
      ? await runtime.services.buddyInvitationEmailWorkerService.processBatch()
      : { processed: 0, failed: 0 };
    const buddyGrowth = buddyCapabilities.goalsAndReports
      ? await runtime.services.buddyMilestoneReportService.processBatch()
      : { relationships: 0, milestones: 0, reports: 0 };

    const context = {
      jobName: "failed-events-replay",
      jobId: "scheduler",
      statusCode: 200,
      latencyMs: 0,
      error: replay.remaining ? `remaining=${replay.remaining}` : undefined,
      smsCleanupRan: smsCleanup.ran,
      smsCleanupDeleted: smsCleanup.deletedCount,
      llmCleanupRan: llmCleanup.ran,
      llmObservationsDeleted: llmCleanup.observations,
      buddyNotificationsProcessed: buddyNotifications.processed,
      buddyNotificationsFailed: buddyNotifications.failed,
      buddyInvitationEmailsProcessed: buddyInvitationEmails.processed,
      buddyInvitationEmailsFailed: buddyInvitationEmails.failed,
      buddyGrowthRelationships: buddyGrowth.relationships,
      buddyMilestonesGenerated: buddyGrowth.milestones,
      buddyReportsGenerated: buddyGrowth.reports,
    };

    if (workerTickLogThrottle.shouldLog(context)) {
      runtime.logger.info("worker tick completed", context);
    }
  });
}

runtime.logger.info("worker started", {
  jobName: "bootstrap",
  jobId: "worker",
  statusCode: 200,
});

void runTick();
setInterval(() => {
  void runTick();
}, 60 * 1000);

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
    await runtime.queue.processDueJobs((job) => runtime.services.notificationService.processQueueJob(job));
    const buddyNotifications = await runtime.services.buddyNotificationWorkerService.processBatch();
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
      buddyNotificationsProcessed: buddyNotifications.processed,
      buddyNotificationsFailed: buddyNotifications.failed,
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

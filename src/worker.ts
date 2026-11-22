import {FilePurgeService} from "./infrastructure/files/file-purge.service.ts";
import {PersistentFileStore} from "./infrastructure/files/persistent-file-store.ts";
import { RedisJobQueue } from "./infrastructure/queue/bullmq/redis-queue.ts";
import { init } from "./infrastructure/runtime/init.ts";
import { resolveRuntimeDatabaseUrl } from "./infrastructure/runtime/runtime-readiness.ts";
import { startWorkerReadiness } from "./infrastructure/runtime/worker-readiness.ts";
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
const databaseUrl = resolveRuntimeDatabaseUrl();
const queue = runtime.queue;
if (!databaseUrl || !(queue instanceof RedisJobQueue)) {
  throw new Error("The worker requires PostgreSQL and a Redis job queue.");
}
await queue.ensureConnected();
startWorkerReadiness(databaseUrl, queue);
const filePurge=new FilePurgeService(runtime.database,new PersistentFileStore());
const workerTickLogThrottle = new WorkerTickLogThrottle();
const buddyCapabilities = resolveBuddyGrowthCapabilities();
const HOUSEKEEPING_INTERVAL_MS = 60 * 1000;
const QUEUE_DRAIN_INTERVAL_MS = 1000;
let tickRunning = false;
let drainRunning = false;

/**
 * 队列消费和清理杂务是两种节奏。
 *
 * 这里原先只在 60 秒一次的清理 tick 里消费队列，结果是任何入队任务（AI 生成、
 * 通知、邮件）平均要等 30 秒、最坏等满 60 秒才开始执行。用户点了「生成」，
 * 界面转圈一分钟才有反应，看上去像坏了。清理可以慢，消费不能慢。
 */
async function drainQueue(): Promise<void> {
  if (drainRunning) return;
  drainRunning = true;
  try {
    await queue.processDueJobs(async (job) => {
      if (job.name.startsWith("lighttick.")) {
        if (job.name === "lighttick.notification.send") await runtime.services.lighttickRuntime.notifications?.process(job);
        else if (job.name === "lighttick.notification.schedule") await runtime.services.lighttickRuntime.notifications?.schedule(job);
        else await runtime.services.lighttickRuntime.worker?.process(job);
        return;
      }
      await runtime.services.notificationService.processQueueJob(job);
    });
  } finally {
    drainRunning = false;
  }
}

async function runTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const filePurges=await filePurge.runBatch();
    await runtime.services.contentSafetyService.cleanupExpiredRecords();
    await runtime.database.getBuddySupportRepository().cleanup("frogsleep", new Date().toISOString());
    const replay = await runtime.services.failedEventRetryService.retryDueEvents();
    const smsCleanup = await runtime.services.smsVerificationCleanupService.runDailyCleanupIfDue();
    const llmCleanup = await runtime.services.llmObservabilityRetentionService.runDailyCleanupIfDue();
    const llmCircuitConfirmation = await runtime.services.llmRouteCircuitRecoveryService.runPendingConfirmations();
    const llmCircuitRecovery = await runtime.services.llmRouteCircuitRecoveryService.runDueRecoveries();
    const llmBalances = await runtime.services.feishuServices.accounts.runDueChecks();
    const llmEmailAlerts = await runtime.services.llmEmailAlertService.runDueAlerts();
    const lighttickJobsRecovered=await runtime.services.lighttickRuntime.worker?.recover()??0;
    await drainQueue();
    const buddyNotifications = await runtime.services.buddyNotificationWorkerService.processBatch();
    const buddyInvitationEmails = buddyCapabilities.explicitInviteConsent && buddyCapabilities.emailDelivery
      ? await runtime.services.buddyInvitationEmailWorkerService.processBatch()
      : { processed: 0, failed: 0 };
    const buddyGrowth = buddyCapabilities.goalsAndReports
      ? await runtime.services.buddyMilestoneReportService.processBatch()
      : { relationships: 0, milestones: 0, reports: 0 };
    const bodyLogSettlement = await runtime.services.bodyLogWorkerService.processBatch();

    const context = {
      ownerFilesRemoved:filePurges.removed,ownerFilesRetried:filePurges.retry,ownerFilesRetained:filePurges.retained,
      lighttickJobsRecovered,
      jobName: "failed-events-replay",
      jobId: "scheduler",
      statusCode: 200,
      latencyMs: 0,
      error: replay.remaining ? `remaining=${replay.remaining}` : undefined,
      smsCleanupRan: smsCleanup.ran,
      smsCleanupDeleted: smsCleanup.deletedCount,
      llmCleanupRan: llmCleanup.ran,
      llmObservationsDeleted: llmCleanup.observations,
      llmCircuitConfirmationAttempted: llmCircuitConfirmation.attempted,
      llmCircuitConfirmationCleared: llmCircuitConfirmation.cleared,
      llmCircuitConfirmationOpened: llmCircuitConfirmation.opened,
      llmCircuitRecoveryAttempted: llmCircuitRecovery.attempted,
      llmCircuitRecoveryRestored: llmCircuitRecovery.restored,
      llmCircuitRecoveryFailed: llmCircuitRecovery.failed,
      llmBalancesChecked: llmBalances.checked,
      llmEmailAlertsHourly: llmEmailAlerts.hourly,
      llmEmailAlertsCircuits: llmEmailAlerts.circuits,
      buddyNotificationsProcessed: buddyNotifications.processed,
      buddyNotificationsFailed: buddyNotifications.failed,
      buddyInvitationEmailsProcessed: buddyInvitationEmails.processed,
      buddyInvitationEmailsFailed: buddyInvitationEmails.failed,
      buddyGrowthRelationships: buddyGrowth.relationships,
      buddyMilestonesGenerated: buddyGrowth.milestones,
      buddyReportsGenerated: buddyGrowth.reports,
      bodyLogDailyBuddySettlement: bodyLogSettlement.dailyBuddySettlement,
      bodyLogDailyGroupSettlement: bodyLogSettlement.dailyGroupSettlement,
      bodyLogWeeklyGroupSettlement: bodyLogSettlement.weeklyGroupSettlement,
    };

    if (workerTickLogThrottle.shouldLog(context)) {
      runtime.logger.info("worker tick completed", context);
    }
  } catch (error) {
    runtime.logger.error("worker tick failed", {
      jobName: "worker-tick",
      jobId: "scheduler",
      statusCode: 500,
      error,
    });
  } finally {
    tickRunning = false;
  }
}

runtime.logger.info("worker started", {
  jobName: "bootstrap",
  jobId: "worker",
  statusCode: 200,
});

void runTick();
setInterval(() => {
  void runTick();
}, HOUSEKEEPING_INTERVAL_MS);
// 队列消费单独用短周期驱动：任务入队后应当尽快开跑，而不是等下一次清理 tick。
setInterval(() => {
  void drainQueue();
}, QUEUE_DRAIN_INTERVAL_MS);

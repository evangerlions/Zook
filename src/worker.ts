import { init } from "./infrastructure/runtime/init.ts";

/**
 * The worker entry mirrors the BullMQ worker deployment shape from the design document.
 * In this scaffold it operates on in-memory adapters, so it is primarily for local verification.
 */
const runtime = await init({
  serviceName: "worker",
  emitLogs: true,
});

async function runTick(): Promise<void> {
  const replay = runtime.services.failedEventRetryService.retryDueEvents();
  await runtime.queue.processDueJobs((job) => runtime.services.notificationService.processQueueJob(job));

  runtime.logger.info("worker tick completed", {
    jobName: "failed-events-replay",
    jobId: "scheduler",
    statusCode: 200,
    latencyMs: 0,
    error: replay.remaining ? `remaining=${replay.remaining}` : undefined,
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

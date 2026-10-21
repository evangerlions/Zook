import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";

/** Single-process timer: no queue, no overlapping passes, no parallel queries. */
export function startAlipayRecovery(
  recover: () => Promise<void>, logger: StructuredLogger, intervalMs = 60_000,
) {
  let running: Promise<void> | undefined;
  let stopped = false;
  const run = (): Promise<void> => {
    if (stopped || running) return Promise.resolve();
    running = Promise.resolve().then(recover).catch(() => {
      logger.warn("ainovel alipay recovery pass failed; retry next interval");
    }).finally(() => { running = undefined; });
    return running;
  };
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref();
  void run();
  return {
    run,
    async stop() { stopped = true; clearInterval(timer); await running; },
  };
}

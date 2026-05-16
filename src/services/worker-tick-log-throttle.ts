export interface WorkerTickLogContext {
  jobName?: string;
  jobId?: string;
  statusCode?: number;
  error?: string;
}

export class WorkerTickLogThrottle {
  private readonly intervalMs: number;
  private readonly now: () => number;
  private lastFailedEventsReplaySuccessLogAt = 0;

  constructor(options: { now?: () => number; intervalMs?: number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.intervalMs = options.intervalMs ?? 20 * 60 * 1000;
  }

  shouldLog(context: WorkerTickLogContext): boolean {
    if (
      context.jobName !== "failed-events-replay"
      || context.jobId !== "scheduler"
      || context.statusCode !== 200
      || context.error
    ) {
      return true;
    }

    const now = this.now();
    if (
      this.lastFailedEventsReplaySuccessLogAt === 0
      || now - this.lastFailedEventsReplaySuccessLogAt >= this.intervalMs
    ) {
      this.lastFailedEventsReplaySuccessLogAt = now;
      return true;
    }

    return false;
  }
}

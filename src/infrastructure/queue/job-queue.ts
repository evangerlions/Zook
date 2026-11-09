import type { QueueJob } from "../../shared/types.ts";

export interface JobQueue {
  add(
    name: string,
    payload: Record<string, unknown>,
    options?: { attempts?: number; backoffMs?: number; jobId?: string },
  ): Promise<QueueJob>;
  processDueJobs(
    handler: (job: QueueJob) => Promise<void> | void,
    now?: Date,
  ): Promise<void>;
  close?(): Promise<void>;
}

export class DeferJobError extends Error {
  constructor(readonly delayMs = 60_000) { super("Job execution is temporarily suspended by product scope."); }
}

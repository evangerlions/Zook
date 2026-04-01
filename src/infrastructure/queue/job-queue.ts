import type { QueueJob } from "../../shared/types.ts";

export interface JobQueue {
  add(
    name: string,
    payload: Record<string, unknown>,
    options?: { attempts?: number; backoffMs?: number },
  ): Promise<QueueJob>;
  processDueJobs(
    handler: (job: QueueJob) => Promise<void> | void,
    now?: Date,
  ): Promise<void>;
  close?(): Promise<void>;
}

import { randomId } from "../../../shared/utils.ts";
import type { QueueJob } from "../../../shared/types.ts";

/**
 * InMemoryJobQueue simulates the BullMQ direct-enqueue and retry contract from the design doc.
 */
export class InMemoryJobQueue {
  readonly jobs: QueueJob[] = [];
  readonly deadLetterQueue: QueueJob[] = [];
  private failNextAdd = false;

  markNextAddAsFailure(): void {
    this.failNextAdd = true;
  }

  add(
    name: string,
    payload: Record<string, unknown>,
    options: { attempts?: number; backoffMs?: number } = {},
  ): QueueJob {
    if (this.failNextAdd) {
      this.failNextAdd = false;
      throw new Error("Queue add failed");
    }

    const job: QueueJob = {
      id: randomId("job"),
      name,
      payload,
      attemptsMade: 0,
      maxAttempts: options.attempts ?? 5,
      backoffMs: options.backoffMs ?? 1000,
      availableAt: new Date().toISOString(),
    };

    this.jobs.push(job);
    return job;
  }

  /**
   * processDueJobs applies exponential backoff and DLQ routing after the final attempt.
   */
  async processDueJobs(
    handler: (job: QueueJob) => Promise<void> | void,
    now = new Date(),
  ): Promise<void> {
    const dueJobs = this.jobs.filter((job) => new Date(job.availableAt) <= now);

    for (const job of dueJobs) {
      try {
        await handler(job);
        this.remove(job.id);
      } catch (error) {
        job.attemptsMade += 1;
        job.failedReason = error instanceof Error ? error.message : "Unknown queue error";

        if (job.attemptsMade >= job.maxAttempts) {
          this.remove(job.id);
          this.deadLetterQueue.push(structuredClone(job));
          continue;
        }

        const delay = job.backoffMs * 2 ** (job.attemptsMade - 1);
        job.availableAt = new Date(now.getTime() + delay).toISOString();
      }
    }
  }

  private remove(jobId: string): void {
    const index = this.jobs.findIndex((item) => item.id === jobId);
    if (index >= 0) {
      this.jobs.splice(index, 1);
    }
  }
}

import { billingEnvironment } from "../../billing/billing-environment.ts";

/** In-process request admission for one application instance. */
export class AiNovelRequestConcurrency {
  private readonly active = new Map<string, Map<string, string>>();

  tryAcquire(userId: string, jobId: string, requestId: string): boolean {
    const key = this.accountKey(userId);
    const requests = this.active.get(key) ?? new Map<string, string>();
    if (requests.size >= 3 || requests.has(jobId)) return false;
    requests.set(jobId, requestId);
    this.active.set(key, requests);
    return true;
  }

  release(userId: string, jobId: string, requestId: string): void {
    const key = this.accountKey(userId);
    const requests = this.active.get(key);
    if (requests?.get(jobId) === requestId) requests.delete(jobId);
    if (requests?.size === 0) this.active.delete(key);
  }

  private accountKey(userId: string): string {
    return `${billingEnvironment()}:${userId}`;
  }
}

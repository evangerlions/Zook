import type { AiNovelCreditsStore, CreditsAccount, CreditsJob, CreditsTransaction } from "../modules/ai-novel/credits/ai-novel-credits-model.ts";

export class InMemoryAiNovelCreditsStore implements AiNovelCreditsStore {
  private readonly accounts = new Map<string, CreditsAccount>();
  private readonly jobs = new Map<string, CreditsJob>();
  private readonly locks = new Map<string, Promise<unknown>>();

  async transact<T>(userId: string, jobId: string, work: (state: CreditsTransaction) => T): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => {
      const key = JSON.stringify([userId, jobId]);
      const state = structuredClone({ account: this.accounts.get(userId), job: this.jobs.get(key) });
      const result = work(state);
      if (state.account) this.accounts.set(userId, state.account);
      if (state.job) this.jobs.set(key, state.job);
      return result;
    });
    this.locks.set(userId, current);
    try { return await current; } finally { if (this.locks.get(userId) === current) this.locks.delete(userId); }
  }
}

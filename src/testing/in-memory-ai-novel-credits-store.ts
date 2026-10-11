import type { AiNovelCreditsStore, CreditsAccount, CreditsJob, CreditsTransaction } from "../modules/ai-novel/credits/ai-novel-credits-model.ts";
import { reportedWindow, invalidatedPreviousWindow, type CreditUsageEvent, type CreditWindowSnapshot } from "../modules/ai-novel/credits/credits-reporting.ts";
import type { UsageSource, UsagePayment } from "../shared/types/ai-novel-usage-admin.ts";

export class InMemoryAiNovelCreditsStore implements AiNovelCreditsStore {
  private readonly accounts = new Map<string, CreditsAccount>();
  private readonly jobs = new Map<string, CreditsJob>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly events = new Map<string, CreditUsageEvent>();
  private readonly windows = new Map<string, CreditWindowSnapshot>();
  private readonly observed = new Map<string, string>();
  /** Explicit fixture seam, never a production payment source. */
  readonly reportPayments: UsagePayment[] = [];
  private reportingSince: string | null = null;

  async transact<T>(userId: string, jobId: string, work: (state: CreditsTransaction) => T): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => {
      const key = JSON.stringify([userId, jobId]);
      const state: CreditsTransaction = structuredClone({ account: this.accounts.get(userId), job: this.jobs.get(key) });
      const result = work(state);
      const event = state.reporting?.event;
      const eventKey = event ? JSON.stringify([userId, event.id]) : "";
      if (event?.kind === "debit" && this.events.has(eventKey)) throw Error("Duplicate credit debit event");
      const invalidated = invalidatedPreviousWindow(state);
      const oldWindow = invalidated ? this.windows.get(JSON.stringify([userId, invalidated])) : undefined;
      if (oldWindow) oldWindow.stable = false;
      const window = reportedWindow(state);
      if (window) {
        const windowKey = JSON.stringify([userId, window.start]);
        const old = this.windows.get(windowKey);
        this.windows.set(windowKey, { ...window, userId, covered: window.covered && (old?.covered ?? true),
          stable: window.stable && (old?.stable ?? true), firstExhaustAt: old?.firstExhaustAt ?? window.firstExhaustAt });
      }
      if (event && !this.events.has(eventKey)) this.events.set(eventKey, { ...structuredClone(event), userId });
      if (state.reporting) {
        this.observed.set(userId, state.reporting.at);
        this.reportingSince ??= state.reporting.at;
      }
      if (state.account) this.accounts.set(userId, state.account);
      if (state.job) this.jobs.set(key, state.job);
      return result;
    });
    this.locks.set(userId, current);
    try { return await current; } finally { if (this.locks.get(userId) === current) this.locks.delete(userId); }
  }

  async readUsageReport(filter: { from: string; to: string; userId?: string }): Promise<UsageSource> {
    const user = (id?: string) => !filter.userId || id === filter.userId;
    return structuredClone({ events: [...this.events.values()].filter(e => user(e.userId) && e.at >= filter.from && e.at < filter.to),
      windows: [...this.windows.values()].filter(w => user(w.userId) && w.start >= filter.from && w.end <= filter.to),
      accounts: [...this.accounts.entries()].filter(([id]) => user(id)).map(([userId, account]) => ({ userId, account, observedAt: this.observed.get(userId)! })),
      payments: this.reportPayments.filter(p => user(p.userId) && p.at >= filter.from && p.at < filter.to), reportingSince: this.reportingSince });
  }
}

import { ApplicationError } from "../shared/errors.ts";
import type { CreditUserCandidate, CreditUserSearchField } from "../modules/ai-novel/credits/admin-credit-search.ts";
import { billingEnvironment } from "../modules/billing/billing-environment.ts";
import type { AiNovelCreditsStore, CreditsAccount, CreditsJob, CreditsTransaction } from "../modules/ai-novel/credits/ai-novel-credits-model.ts";
import { reportedWindow, invalidatedPreviousWindow, type CreditUsageEvent, type CreditWindowSnapshot } from "../modules/ai-novel/credits/credits-reporting.ts";
import type { UsageSource, UsagePayment } from "../shared/types/ai-novel-usage-admin.ts";

export class InMemoryAiNovelCreditsStore implements AiNovelCreditsStore {
  constructor(private readonly users: () => CreditUserCandidate[] = () => []) {}
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
    const environment = billingEnvironment();
    const accountKey = JSON.stringify([userId, environment]);
    const previous = this.locks.get(accountKey) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => {
      const key = JSON.stringify([userId, environment, jobId]);
      const state: CreditsTransaction = structuredClone({ account: this.accounts.get(accountKey), job: this.jobs.get(key) });
      const result = work(state);
      const event = state.reporting?.event;
      const eventKey = event ? JSON.stringify([userId, environment, event.id]) : "";
      if (event?.kind === "debit" && this.events.has(eventKey)) throw Error("Duplicate credit debit event");
      if (event?.kind === "grant" && event.adminUser && [...this.events.entries()].some(([key, old]) => {
        const [, env, eventId] = JSON.parse(key);
        return env === environment && eventId === event.id && old.adminUser;
      })) throw new ApplicationError(409, "AINOVEL_CREDITS_JOB_CONFLICT", "Grant key was already used for another user.");
      const invalidated = invalidatedPreviousWindow(state);
      const oldWindow = invalidated ? this.windows.get(JSON.stringify([userId, environment, invalidated])) : undefined;
      if (oldWindow) oldWindow.stable = false;
      const window = reportedWindow(state);
      if (window) {
        const windowKey = JSON.stringify([userId, environment, window.start]);
        const old = this.windows.get(windowKey);
        this.windows.set(windowKey, { ...window, userId, covered: window.covered && (old?.covered ?? true),
          stable: window.stable && (old?.stable ?? true), firstExhaustAt: old?.firstExhaustAt ?? window.firstExhaustAt });
      }
      if (event && !this.events.has(eventKey)) this.events.set(eventKey, { ...structuredClone(event), userId });
      if (state.reporting) {
        this.observed.set(accountKey, state.reporting.at);
        this.reportingSince ??= state.reporting.at;
      }
      if (state.account) this.accounts.set(accountKey, state.account);
      if (state.job) this.jobs.set(key, state.job);
      return result;
    });
    this.locks.set(accountKey, current);
    try { return await current; } finally { if (this.locks.get(accountKey) === current) this.locks.delete(accountKey); }
  }

  async searchUsers(field: CreditUserSearchField, term: string) {
    const needle = term.toLowerCase();
    return this.users().filter(user => (user[field] ?? "").toLowerCase().includes(needle))
      .sort((a, b) => a.uid.localeCompare(b.uid)).slice(0, 11);
  }

  async listAdminGrants(offset: number, limit: number) {
    return [...this.events.entries()]
      .filter(([key, event]) => JSON.parse(key)[1] === billingEnvironment() && event.kind === "grant" && event.adminUser)
      .map(([, event]) => ({ id: event.id, uid: event.userId!, points: Number(BigInt(event.giftMicros) / 1000000n), adminUser: event.adminUser!, at: event.at }))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(offset, offset + limit);
  }

  async readUsageReport(filter: { from: string; to: string; userId?: string }): Promise<UsageSource> {
    const user = (id?: string) => !filter.userId || id === filter.userId;
    return structuredClone({ events: [...this.events.entries()].filter(([key]) => JSON.parse(key)[1] === billingEnvironment()).map(([,value]) => value).filter(e => user(e.userId) && e.at >= filter.from && e.at < filter.to),
      windows: [...this.windows.entries()].filter(([key]) => JSON.parse(key)[1] === billingEnvironment()).map(([,value]) => value).filter(w => user(w.userId) && w.start >= filter.from && w.end <= filter.to),
      accounts: [...this.accounts.entries()].filter(([key]) => JSON.parse(key)[1] === billingEnvironment() && user(JSON.parse(key)[0])).map(([key, account]) => ({ userId: JSON.parse(key)[0], account, observedAt: this.observed.get(key)! })),
      payments: this.reportPayments.filter(p => user(p.userId) && p.at >= filter.from && p.at < filter.to), reportingSince: this.reportingSince });
  }
}

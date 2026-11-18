import { randomUUID } from "node:crypto";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import type { SearchConfig } from "./search-config.ts";
import type { SearchInput, SearchOutcome } from "./search-types.ts";

interface UserUsage { day: string; count: number; leases: Record<string, number> }
export interface SearchRecord { requestId: string; userId: string; sceneKey: string; toolCallId: string; timestamp: string; status: string; code?: string; returnedCount: number; filteredCount: number; latencyMs: number; provider: "deepseek"; upstreamCalls: number; input?: SearchInput; output?: SearchOutcome | { status: "cancelled" } }
const scope = "ai-novel-web-search";

/** Per-user compare-and-set bounds spend and concurrency across API instances. */
export class SearchUsage {
  constructor(private readonly kv: KVManager, private readonly now: () => number = Date.now) {}
  async acquire(userId: string, config: SearchConfig): Promise<{ release: () => Promise<void> } | "RATE_LIMITED" | "BUDGET_EXCEEDED"> {
    const leaseId = randomUUID();
    for (let attempt = 0; attempt < 12; attempt++) {
      const raw = await this.kv.getString(scope, userId);
      const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
      const previous: UserUsage = raw ? JSON.parse(raw) : { day, count: 0, leases: {} };
      const leases = Object.fromEntries(Object.entries(previous.leases).filter(([, expiry]) => expiry > now));
      const count = previous.day === day ? previous.count : 0;
      if (count >= config.dailyLimit) return "BUDGET_EXCEEDED";
      if (Object.keys(leases).length >= config.concurrentLimit) return "RATE_LIMITED";
      leases[leaseId] = now + config.totalTimeoutMs + 1000;
      if (await this.kv.applyAtomic(scope, { compare: [{ key: userId, value: raw ?? null }], set: [{ key: userId, value: JSON.stringify({ day, count: count + 1, leases }), ttlSeconds: 172800 }] })) {
        return { release: () => this.release(userId, leaseId) };
      }
    }
    return "RATE_LIMITED";
  }
  private async release(userId: string, leaseId: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const raw = await this.kv.getString(scope, userId);
      if (!raw) return;
      const state: UserUsage = JSON.parse(raw);
      delete state.leases[leaseId];
      if (await this.kv.applyAtomic(scope, { compare: [{ key: userId, value: raw }], set: [{ key: userId, value: JSON.stringify(state), ttlSeconds: 172800 }] })) return;
    }
    // The expiring lease remains bounded by the original request deadline.
  }
  async records(): Promise<SearchRecord[]> { return ((await this.kv.getJson<SearchRecord[]>(scope, "records")) ?? []).slice(0, 100); }
  async record(record: SearchRecord) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const raw = await this.kv.getString(scope, "records");
      const records: SearchRecord[] = raw ? JSON.parse(raw) : [];
      if (await this.kv.applyAtomic(scope, { compare: [{ key: "records", value: raw ?? null }], set: [{ key: "records", value: JSON.stringify([record, ...records].slice(0, 100)) }] })) return;
    }
    throw new Error("Could not persist search usage record.");
  }
}

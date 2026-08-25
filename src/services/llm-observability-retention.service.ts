import type { LlmObservabilityStore } from "../infrastructure/database/llm-observability-store.ts";
import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { toDateKey } from "../shared/utils.ts";

const RETENTION_DAYS = 35;
const RETENTION_SCOPE = "llm-observability-retention";
const LAST_RUN_KEY = "last-run-date";

export class LlmObservabilityRetentionService {
  constructor(
    private readonly store: LlmObservabilityStore,
    private readonly kvManager: KVManager,
  ) {}

  async runDailyCleanupIfDue(now = new Date()): Promise<{
    ran: boolean;
    observations: number;
  }> {
    const today = toDateKey(now, "Asia/Shanghai");
    if (await this.kvManager.getString(RETENTION_SCOPE, LAST_RUN_KEY) === today) {
      return { ran: false, observations: 0 };
    }
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.store.deleteBefore(cutoff.toISOString());
    await this.kvManager.setString(RETENTION_SCOPE, LAST_RUN_KEY, today);
    return { ran: true, ...result };
  }
}

import { withContentSafetyTimeout } from "./content-safety-helpers.ts";
import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { AdminContentSafetyStatsDocument, ContentSafetyConfig } from "../shared/types.ts";
import { badRequest } from "../shared/errors.ts";
import { enumerateDateKeys, toDateKey } from "../shared/utils.ts";
import type { ContentSafetyCheckCommand, ContentSafetyRecordInput, ContentSafetyStatsFilter } from "./content-safety-types.ts";

const SCOPE = "content-safety-counters-v1";
const TTL_SECONDS = 35 * 86400;
type Counts = Record<string, number>;

export class ContentSafetyCounters {
  private lastWarningAt = -Infinity;
  constructor(
    private readonly kv: KVManager,
    private readonly logger?: StructuredLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async started(command: ContentSafetyCheckCommand): Promise<void> {
    await this.increment(command, { total: 1 });
  }

  async completed(command: ContentSafetyCheckCommand, config: ContentSafetyConfig, input: ContentSafetyRecordInput): Promise<void> {
    const successful = input.decision !== "failed_open";
    const model = input.method === "llm" || (input.method === "failed_open" && input.modelKey)
      ? (config.llm.useJev ? "jev" : /^qwen/.test(config.llm.modelKey) ? "qwen" : config.llm.modelKey.slice(0, 80))
      : input.method === "failed_open" ? "aliyun" : input.method;
    const fields: Counts = { [input.decision]: 1, successful: successful ? 1 : 0 };
    fields[`model:${model}:count`] = 1;
    fields[`model:${model}:${input.decision}`] = 1;
    fields[`model:${model}:successful`] = successful ? 1 : 0;
    if (input.decision === "block") {
      // Bounded configured categories, never user text or IDs.
      const category = input.category?.slice(0, 80) || "unknown";
      fields[`category:${category}`] = 1;
    }
    await this.increment(command, fields);
  }

  async getStats(filter: ContentSafetyStatsFilter): Promise<AdminContentSafetyStatsDocument> {
    if (filter.appId || filter.source || filter.method || filter.taskType) {
      badRequest("REQ_INVALID_QUERY", "Redis safety counters support date filters only.");
    }
    const today = toDateKey(this.now());
    const earliest = toDateKey(new Date(this.now().getTime() - 29 * 86400000));
    let from = validDate(filter.dateFrom) ?? earliest;
    let to = validDate(filter.dateTo) ?? today;
    if (from > to) [from, to] = [to, from];
    from = from < earliest ? earliest : from;
    to = to > today ? today : to;
    const days = from > to ? [] : enumerateDateKeys(from, to);
    const counts = await withContentSafetyTimeout(Promise.all(days.map(day => this.kv.getCounters(SCOPE, day))), 1500);
    const all: Counts = {};
    for (const item of counts) for (const [field, value] of Object.entries(item)) all[field] = (all[field] ?? 0) + value;
    const summary = readSummary(all);
    return {
      timezone: "Asia/Shanghai",
      storage: "redis",
      summary: { ...summary, blockRate: ratio(summary.blocked, summary.total), failedOpenRate: ratio(summary.failedOpen, summary.total) },
      daily: days.map((date, index) => ({ date, ...readSummary(counts[index]) })),
      byCategory: Object.entries(all).filter(([key]) => key.startsWith("category:"))
        .map(([key, count]) => ({ key: key.slice(9), count, blocked: count, successful: count, passed: 0, failedOpen: 0 }))
        .sort((a, b) => b.count - a.count),
      byModel: Object.keys(all).filter(key => key.startsWith("model:") && key.endsWith(":count"))
        .map(key => {
          const model = key.slice(6, -6);
          const get = (field: string) => all[`model:${model}:${field}`] ?? 0;
          return { key: model, count: get("count"), successful: get("successful"), passed: get("pass"), blocked: get("block"), failedOpen: get("failed_open") };
        }).sort((a, b) => b.count - a.count),
    };
  }

  private async increment(command: ContentSafetyCheckCommand, fields: Counts): Promise<void> {
    try {
      await withContentSafetyTimeout(this.kv.incrementCounters(SCOPE, command.statsDate ?? toDateKey(this.now()), fields, TTL_SECONDS), 150);
    } catch {
      // Observability must not turn a moderation decision into fail-open or a user error.
      const now = this.now().getTime();
      if (now - this.lastWarningAt >= 60_000) {
        this.lastWarningAt = now;
        this.logger?.warn("content safety counter write failed", { requestId: command.requestId });
      }
    }
  }
}

function readSummary(counts: Counts) {
  return { total: counts.total ?? 0, successful: counts.successful ?? 0, passed: counts.pass ?? 0,
    blocked: counts.block ?? 0, failedOpen: counts.failed_open ?? 0 };
}

function validDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    badRequest("REQ_INVALID_QUERY", "Invalid safety counter date.");
  }
  return value;
}

function ratio(value: number, total: number): number {
  return total ? Number((value / total).toFixed(4)) : 0;
}

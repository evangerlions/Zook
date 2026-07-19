import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type {
  AdminContentSafetyBlockRecordItem,
  AdminContentSafetyBlockRecordsDocument,
  AdminContentSafetyStatsBucket,
  AdminContentSafetyStatsDocument,
  ContentSafetyCheckMethod,
  ContentSafetyCheckRecord,
  ContentSafetyCheckSource,
  ContentSafetyConfig,
} from "../shared/types.ts";
import { enumerateDateKeys, randomId, toDateKey } from "../shared/utils.ts";
import { hashContentSafetyText } from "./content-safety-helpers.ts";
import type {
  ContentSafetyCheckCommand,
  ContentSafetyRecordInput,
  ContentSafetyStatsFilter,
} from "./content-safety-types.ts";

export class ContentSafetyRecordStore {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly logger?: StructuredLogger,
  ) {}

  async recordCheck(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    input: ContentSafetyRecordInput,
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.cleanupExpiredRecords();
    try {
      await this.database.insertContentSafetyCheckRecord({
        id: randomId("csf"),
        appId: command.appId,
        userId: command.userId,
        requestId: command.requestId,
        taskType: command.taskType,
        source: command.source ?? (command.taskType === "admin_content_safety_test" ? "admin_test" : "business"),
        method: input.method,
        decision: input.decision,
        category: input.category,
        keywordId: input.keywordId,
        text: input.blockedText,
        textLength: input.text.length,
        textHash: hashContentSafetyText(input.text),
        latencyMs: input.latencyMs,
        modelKey: input.modelKey,
        provider: input.provider,
        providerModel: input.providerModel,
        failureReason: input.failureReason,
        failureDetail: input.failureDetail,
        metadata: {
          thresholdChars: config.longTextThresholdChars,
          ...input.metadata,
        },
        createdAt,
      });
    } catch (error) {
      this.logger?.warn("content safety check record write failed", {
        appId: command.appId,
        requestId: command.requestId,
        taskType: command.taskType,
        decision: input.decision,
        method: input.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async listBlockRecords(filter: ContentSafetyStatsFilter): Promise<AdminContentSafetyBlockRecordsDocument> {
    const range = normalizeStatsFilter(filter);
    const queryRange = toShanghaiIsoRange(range);
    await this.cleanupExpiredRecords();
    const records = await this.database.listContentSafetyCheckRecords({
      ...queryRange,
      appId: filter.appId?.trim() || undefined,
      source: parseSource(filter.source),
      method: parseMethod(filter.method),
      taskType: filter.taskType?.trim() || undefined,
      decision: "block",
      limit: 1000,
    });
    return {
      timezone: "Asia/Shanghai",
      items: records
        .filter((record) => record.text)
        .map((record) => ({
          id: record.id,
          appId: record.appId,
          userId: record.userId,
          requestId: record.requestId,
          taskType: record.taskType,
          source: record.source,
          method: record.method as AdminContentSafetyBlockRecordItem["method"],
          category: record.category,
          keywordId: record.keywordId,
          text: record.text as string,
          textLength: record.textLength,
          textHash: record.textHash,
          modelKey: record.modelKey,
          provider: record.provider,
          providerModel: record.providerModel,
          createdAt: record.createdAt,
        })),
    };
  }

  async getStats(filter: ContentSafetyStatsFilter): Promise<AdminContentSafetyStatsDocument> {
    const range = normalizeStatsFilter(filter);
    const queryRange = toShanghaiIsoRange(range);
    await this.cleanupExpiredRecords();
    const records = await this.database.listContentSafetyCheckRecords({
      ...queryRange,
      appId: filter.appId?.trim() || undefined,
      source: parseSource(filter.source),
      method: parseMethod(filter.method),
      taskType: filter.taskType?.trim() || undefined,
    });
    const total = records.length;
    const blocked = records.filter((record) => record.decision === "block").length;
    const failedOpen = records.filter((record) => record.decision === "failed_open").length;
    const latencyValues = records
      .map((record) => record.latencyMs)
      .filter((value): value is number => typeof value === "number");

    return {
      timezone: "Asia/Shanghai",
      summary: {
        total,
        passed: total - blocked - failedOpen,
        blocked,
        failedOpen,
        blockRate: ratio(blocked, total),
        failedOpenRate: ratio(failedOpen, total),
        avgLatencyMs: average(latencyValues),
        p95LatencyMs: percentile(latencyValues, 0.95),
      },
      daily: enumerateDateKeys(range.dateFrom, range.dateTo).map((date) => {
        const dailyRecords = records.filter((record) => toDateKey(record.createdAt) === date);
        return {
          date,
          total: dailyRecords.length,
          passed: dailyRecords.filter((record) => record.decision === "pass").length,
          blocked: dailyRecords.filter((record) => record.decision === "block").length,
          failedOpen: dailyRecords.filter((record) => record.decision === "failed_open").length,
        };
      }),
      byMethod: bucketRecords(records, (record) => record.method),
      bySource: bucketRecords(records, (record) => record.source),
      byApp: bucketRecords(records, (record) => record.appId),
      byTaskType: bucketRecords(records, (record) => record.taskType ?? "unknown"),
      byCategory: bucketRecords(records, (record) => record.category ?? "none"),
      byFailureReason: bucketRecords(records, (record) => record.failureReason ?? "none"),
      byLengthBucket: bucketRecords(records, (record) => lengthBucket(record.textLength)),
    };
  }

  private async cleanupExpiredRecords(): Promise<void> {
    try {
      await this.database.deleteContentSafetyCheckRecordsCreatedBefore(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
    } catch (error) {
      this.logger?.warn("content safety check record cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function normalizeStatsFilter(filter: ContentSafetyStatsFilter): { dateFrom: string; dateTo: string } {
  const today = toDateKey(new Date().toISOString());
  const defaultFrom = toDateKey(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString());
  const dateFrom = normalizeDateKey(filter.dateFrom) ?? defaultFrom;
  const dateTo = normalizeDateKey(filter.dateTo) ?? today;
  return dateFrom <= dateTo
    ? { dateFrom, dateTo }
    : { dateFrom: dateTo, dateTo: dateFrom };
}

function normalizeDateKey(value?: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  return value;
}

function toShanghaiIsoRange(range: { dateFrom: string; dateTo: string }): {
  createdAtFromIso: string;
  createdAtToIso: string;
} {
  return {
    createdAtFromIso: shanghaiDateStartToIso(range.dateFrom),
    createdAtToIso: shanghaiDateStartToIso(addDays(range.dateTo, 1)),
  };
}

function shanghaiDateStartToIso(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000).toISOString();
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function parseSource(value?: string): ContentSafetyCheckSource | undefined {
  return value === "business" || value === "admin_test" ? value : undefined;
}

function parseMethod(value?: string): ContentSafetyCheckMethod | undefined {
  return value === "disabled" ||
      value === "keyword" ||
      value === "llm" ||
      value === "aliyun" ||
      value === "failed_open"
    ? value
    : undefined;
}

function bucketRecords(
  records: ContentSafetyCheckRecord[],
  getKey: (record: ContentSafetyCheckRecord) => string,
): AdminContentSafetyStatsBucket[] {
  const groups = new Map<string, ContentSafetyCheckRecord[]>();
  records.forEach((record) => {
    const key = getKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });
  return [...groups.entries()]
    .map(([key, items]) => {
      const latencies = items
        .map((item) => item.latencyMs)
        .filter((value): value is number => typeof value === "number");
      return {
        key,
        count: items.length,
        blocked: items.filter((item) => item.decision === "block").length,
        failedOpen: items.filter((item) => item.decision === "failed_open").length,
        avgLatencyMs: average(latencies),
        p95LatencyMs: percentile(latencies, 0.95),
      };
    })
    .sort((left, right) => right.count - left.count);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function lengthBucket(length: number): string {
  if (length <= 100) {
    return "0-100";
  }
  if (length <= 500) {
    return "101-500";
  }
  if (length <= 2000) {
    return "501-2000";
  }
  return "2000+";
}

import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type {
  AdminContentSafetyBlockRecordItem,
  AdminContentSafetyBlockRecordsDocument,
  ContentSafetyCheckMethod,
  ContentSafetyCheckSource,
  ContentSafetyConfig,
} from "../shared/types.ts";
import { randomId, toDateKey } from "../shared/utils.ts";
import type { ContentSafetyCounters } from "./content-safety-counters.ts";
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
    private readonly now: () => Date = () => new Date(),
    private readonly counters?: ContentSafetyCounters,
  ) {}

  async recordCheck(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    input: ContentSafetyRecordInput,
  ): Promise<void> {
    const createdAt = this.now().toISOString();
    await this.counters?.completed(command, config, input);
    if (input.decision !== "block") return;
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
    const range = normalizeStatsFilter(filter, this.now());
    const queryRange = toShanghaiIsoRange(range);
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

  async cleanupExpiredRecords(): Promise<void> {
    try {
      await this.database.deleteContentSafetyCheckRecordsCreatedBefore(
        new Date(this.now().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
    } catch (error) {
      this.logger?.warn("content safety check record cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function normalizeStatsFilter(
  filter: ContentSafetyStatsFilter,
  now: Date,
): { dateFrom: string; dateTo: string } {
  const today = toDateKey(now.toISOString());
  const defaultFrom = toDateKey(
    new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString(),
  );
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

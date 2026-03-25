import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  LlmHourlySeriesItem,
  LlmMetricsRange,
  LlmMetricsSummary,
  LlmRouteMetricsGroup,
  LlmServiceConfig,
} from "../shared/types.ts";
import { badRequest } from "../shared/errors.ts";
import { toHourKey } from "../shared/utils.ts";
import type { LLMUsage } from "./llm-manager.ts";

const METRICS_RETENTION_HOURS = 24 * 365;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const METRICS_INDEX_KEY = "index";

interface LlmMetricBucket {
  hour: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  firstByteLatencySumMs: number;
  totalLatencySumMs: number;
  firstByteLatencyMaxMs: number;
  totalLatencyMaxMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  firstByteLatencyDigest: number[];
  totalLatencyDigest: number[];
}

interface LlmMetricScopeIndex {
  version: 1;
  hours: string[];
}

export interface LlmMetricEvent {
  modelKey: string;
  provider: string;
  providerModel: string;
  ok: boolean;
  firstByteLatencyMs: number;
  totalLatencyMs: number;
  usage?: LLMUsage;
  occurredAt?: Date;
}

export class LlmMetricsService {
  constructor(private readonly kvManager: KVManager) {}

  async recordCall(event: LlmMetricEvent): Promise<void> {
    const occurredAt = event.occurredAt ?? new Date();
    const hour = toHourKey(occurredAt, DEFAULT_TIMEZONE);
    const scopes = [
      this.globalScope(),
      this.modelScope(event.modelKey),
      this.routeScope(event.modelKey, event.provider, event.providerModel),
    ];

    await Promise.all(scopes.map((scope) => this.upsertBucket(scope, hour, event, occurredAt)));
  }

  async getOverview(config: LlmServiceConfig, range: LlmMetricsRange, now = new Date()): Promise<AdminLlmMetricsDocument> {
    const hours = buildHourKeys(range, now);
    const summary = this.summarizeBuckets(await this.readBuckets(this.globalScope(), hours), hours);
    const models = await Promise.all(
      config.models.map(async (model) => ({
        modelKey: model.key,
        label: model.label,
        summary: this.summarizeBuckets(await this.readBuckets(this.modelScope(model.key), hours), hours),
        items: await this.readSeries(this.modelScope(model.key), hours),
      })),
    );

    return {
      timezone: DEFAULT_TIMEZONE,
      range,
      summary,
      models,
    };
  }

  async getModelDetail(
    config: LlmServiceConfig,
    modelKey: string,
    range: LlmMetricsRange,
    now = new Date(),
  ): Promise<AdminLlmModelMetricsDocument> {
    const model = config.models.find((item) => item.key === modelKey);
    if (!model) {
      badRequest("REQ_INVALID_QUERY", `Unknown modelKey: ${modelKey}.`);
    }

    const hours = buildHourKeys(range, now);
    const summary = this.summarizeBuckets(await this.readBuckets(this.modelScope(model.key), hours), hours);
    const routes = await Promise.all(
      model.routes.map(async (route) => ({
        modelKey: model.key,
        provider: route.provider,
        providerModel: route.providerModel,
        summary: this.summarizeBuckets(
          await this.readBuckets(this.routeScope(model.key, route.provider, route.providerModel), hours),
          hours,
        ),
        items: await this.readSeries(this.routeScope(model.key, route.provider, route.providerModel), hours),
      } satisfies LlmRouteMetricsGroup)),
    );

    return {
      timezone: DEFAULT_TIMEZONE,
      range,
      modelKey: model.key,
      label: model.label,
      summary,
      routes,
    };
  }

  private async upsertBucket(scope: string, hour: string, event: LlmMetricEvent, now: Date): Promise<void> {
    const existing = (await this.kvManager.getJson<LlmMetricBucket>(scope, hour)) ?? createEmptyBucket(hour);
    const firstByteLatencyMs = Math.max(0, Math.round(event.firstByteLatencyMs));
    const totalLatencyMs = Math.max(0, Math.round(event.totalLatencyMs));
    const next: LlmMetricBucket = {
      hour,
      requestCount: existing.requestCount + 1,
      successCount: existing.successCount + (event.ok ? 1 : 0),
      failureCount: existing.failureCount + (event.ok ? 0 : 1),
      firstByteLatencySumMs: existing.firstByteLatencySumMs + firstByteLatencyMs,
      totalLatencySumMs: existing.totalLatencySumMs + totalLatencyMs,
      firstByteLatencyMaxMs: Math.max(existing.firstByteLatencyMaxMs, firstByteLatencyMs),
      totalLatencyMaxMs: Math.max(existing.totalLatencyMaxMs, totalLatencyMs),
      promptTokens: existing.promptTokens + (event.usage?.promptTokens ?? 0),
      completionTokens: existing.completionTokens + (event.usage?.completionTokens ?? 0),
      totalTokens: existing.totalTokens + (event.usage?.totalTokens ?? 0),
      firstByteLatencyDigest: [...existing.firstByteLatencyDigest, firstByteLatencyMs],
      totalLatencyDigest: [...existing.totalLatencyDigest, totalLatencyMs],
    };

    await this.kvManager.setJson(scope, hour, next);
    await this.updateIndex(scope, hour, now);
  }

  private async readSeries(scope: string, hours: string[]): Promise<LlmHourlySeriesItem[]> {
    const buckets = await this.readBuckets(scope, hours);
    return hours.map((hour) => toHourlySeriesItem(buckets.get(hour) ?? createEmptyBucket(hour)));
  }

  private async readBuckets(scope: string, hours: string[]): Promise<Map<string, LlmMetricBucket>> {
    const entries = await Promise.all(
      hours.map(async (hour) => [hour, await this.kvManager.getJson<LlmMetricBucket>(scope, hour)] as const),
    );
    return new Map(entries.filter((entry): entry is readonly [string, LlmMetricBucket] => Boolean(entry[1])));
  }

  private summarizeBuckets(buckets: Map<string, LlmMetricBucket>, hours: string[]): LlmMetricsSummary {
    const merged = hours
      .map((hour) => buckets.get(hour))
      .filter((item): item is LlmMetricBucket => Boolean(item))
      .reduce<LlmMetricBucket>(
        (acc, item) => ({
          hour: "summary",
          requestCount: acc.requestCount + item.requestCount,
          successCount: acc.successCount + item.successCount,
          failureCount: acc.failureCount + item.failureCount,
          firstByteLatencySumMs: acc.firstByteLatencySumMs + item.firstByteLatencySumMs,
          totalLatencySumMs: acc.totalLatencySumMs + item.totalLatencySumMs,
          firstByteLatencyMaxMs: Math.max(acc.firstByteLatencyMaxMs, item.firstByteLatencyMaxMs),
          totalLatencyMaxMs: Math.max(acc.totalLatencyMaxMs, item.totalLatencyMaxMs),
          promptTokens: acc.promptTokens + item.promptTokens,
          completionTokens: acc.completionTokens + item.completionTokens,
          totalTokens: acc.totalTokens + item.totalTokens,
          firstByteLatencyDigest: [...acc.firstByteLatencyDigest, ...item.firstByteLatencyDigest],
          totalLatencyDigest: [...acc.totalLatencyDigest, ...item.totalLatencyDigest],
        }),
        createEmptyBucket("summary"),
      );

    return toSummary(merged);
  }

  private async updateIndex(scope: string, hour: string, now: Date): Promise<void> {
    const current =
      (await this.kvManager.getJson<LlmMetricScopeIndex>(scope, METRICS_INDEX_KEY)) ?? {
        version: 1,
        hours: [],
      };
    const cutoff = toHourKey(new Date(now.getTime() - METRICS_RETENTION_HOURS * 60 * 60 * 1000), DEFAULT_TIMEZONE);
    const hours = Array.from(new Set([...current.hours, hour])).sort();
    const keptHours = hours.filter((item) => item >= cutoff);
    const removedHours = hours.filter((item) => item < cutoff);

    await Promise.all(removedHours.map((item) => this.kvManager.delete(scope, item)));
    await this.kvManager.setJson(scope, METRICS_INDEX_KEY, {
      version: 1,
      hours: keptHours,
    } satisfies LlmMetricScopeIndex);
  }

  private globalScope(): string {
    return "llm-metrics:global";
  }

  private modelScope(modelKey: string): string {
    return `llm-metrics:model:${modelKey}`;
  }

  private routeScope(modelKey: string, provider: string, providerModel: string): string {
    return `llm-metrics:route:${modelKey}:${provider}:${providerModel}`;
  }
}

function createEmptyBucket(hour: string): LlmMetricBucket {
  return {
    hour,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    firstByteLatencySumMs: 0,
    totalLatencySumMs: 0,
    firstByteLatencyMaxMs: 0,
    totalLatencyMaxMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    firstByteLatencyDigest: [],
    totalLatencyDigest: [],
  };
}

function toHourlySeriesItem(bucket: LlmMetricBucket): LlmHourlySeriesItem {
  return {
    hour: bucket.hour,
    ...toSummary(bucket),
  };
}

function toSummary(bucket: LlmMetricBucket): LlmMetricsSummary {
  return {
    requestCount: bucket.requestCount,
    successCount: bucket.successCount,
    failureCount: bucket.failureCount,
    successRate: bucket.requestCount ? roundTwo((bucket.successCount / bucket.requestCount) * 100) : 100,
    avgFirstByteLatencyMs: bucket.requestCount ? Math.round(bucket.firstByteLatencySumMs / bucket.requestCount) : 0,
    avgTotalLatencyMs: bucket.requestCount ? Math.round(bucket.totalLatencySumMs / bucket.requestCount) : 0,
    p95FirstByteLatencyMs: percentile(bucket.firstByteLatencyDigest, 95),
    p95TotalLatencyMs: percentile(bucket.totalLatencyDigest, 95),
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    totalTokens: bucket.totalTokens,
  };
}

function buildHourKeys(range: LlmMetricsRange, now: Date): string[] {
  const count = rangeToHours(range);
  const keys = new Set<string>();
  for (let index = count - 1; index >= 0; index -= 1) {
    keys.add(toHourKey(new Date(now.getTime() - index * 60 * 60 * 1000), DEFAULT_TIMEZONE));
  }
  return [...keys];
}

function rangeToHours(range: LlmMetricsRange): number {
  if (range === "24h") {
    return 24;
  }
  if (range === "7d") {
    return 24 * 7;
  }
  if (range === "30d") {
    return 24 * 30;
  }
  badRequest("REQ_INVALID_QUERY", `Unsupported LLM metrics range: ${range}`);
}

function percentile(values: number[], targetPercentile: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((targetPercentile / 100) * sorted.length) - 1);
  return Math.round(sorted[index] ?? 0);
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

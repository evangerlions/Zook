import type {
  LlmObservationAggregate,
  LlmObservabilityStore,
} from "../infrastructure/database/llm-observability-store.ts";
import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  LlmHourlySeriesItem,
  LlmMetricsOperation,
  LlmMetricsRange,
  LlmMetricsSummary,
  LlmServiceConfig,
} from "../shared/types.ts";
import { badRequest } from "../shared/errors.ts";
import { toDateKey, toHourKey } from "../shared/utils.ts";
import type { LlmHealthService } from "./llm-health.service.ts";
import { LlmCallObservationRecorder } from "./llm-call-observation.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export interface LlmMetricsQuery {
  operation?: LlmMetricsOperation;
  provider?: string;
  providerModel?: string;
  routingModelKey?: string;
  configRevision?: number;
  configUpdatedAt?: string;
}

export class LlmMetricsService {
  readonly observationRecorder: LlmCallObservationRecorder;

  constructor(
    private readonly store: LlmObservabilityStore,
    private readonly healthService: LlmHealthService,
    logger?: StructuredLogger,
  ) {
    this.observationRecorder = new LlmCallObservationRecorder(store, logger);
  }

  async getOverview(
    config: LlmServiceConfig,
    range: LlmMetricsRange,
    now = new Date(),
    queryInput: string | LlmMetricsQuery = {},
  ): Promise<AdminLlmMetricsDocument> {
    const query = typeof queryInput === "string" ? { provider: queryInput } : queryInput;
    this.assertKnownProvider(config, query.provider);
    const window = buildMetricsWindow(range, now);
    const result = await this.store.queryMetrics({
      occurredAtFrom: window.from.toISOString(),
      occurredAtTo: window.to.toISOString(),
      granularity: window.granularity,
      operation: query.operation,
      provider: query.provider,
      providerModel: query.providerModel,
      routingModelKey: query.routingModelKey,
    });
    const runtime = {
      generatedAt: now.toISOString(),
      configRevision: query.configRevision,
      configUpdatedAt: query.configUpdatedAt,
      models: await Promise.all(config.models.map((model) =>
        this.healthService.buildModelRuntimeStatus(model, config.providers),
      )),
    };
    const providerLabels = new Map(config.providers.map((item) => [item.key, item.label || item.key]));

    return {
      generatedAt: now.toISOString(),
      dataAvailableSince: result.dataAvailableSince,
      timezone: DEFAULT_TIMEZONE,
      range,
      granularity: window.granularity,
      operation: query.operation,
      provider: query.provider,
      providerModel: query.providerModel,
      summary: toMetricsSummary(result.summary, Boolean(query.operation)),
      latencyByOperation: Object.fromEntries(
        Object.entries(result.latencyByOperation).map(([operation, aggregate]) => [
          operation,
          toMetricsSummary(aggregate),
        ]),
      ),
      items: buildTimeline(
        window.keys,
        result.timeline,
        result.dataAvailableSince,
        window.granularity,
        Boolean(query.operation),
      ),
      providers: config.providers.map((provider) => ({
        provider: provider.key,
        label: provider.label || provider.key,
      })),
      providerMetrics: {
        ...result.providers,
        items: result.providers.items.filter((item) => query.provider ? item.provider === query.provider : true).map((item) => ({
          provider: item.provider,
          label: providerLabels.get(item.provider) ?? item.provider,
          operation: item.operation,
          summary: toMetricsSummary(item),
          trafficShare: item.operationRequestCount
            ? roundTwo((item.requestCount / item.operationRequestCount) * 100)
            : 0,
        })),
      },
      models: {
        ...result.providerModels,
        items: result.providerModels.items.map((item) => ({
          modelKey: item.providerModel,
          providerModel: item.providerModel,
          label: item.providerModel,
          operation: item.operation,
          summary: toMetricsSummary(item),
        })),
      },
      routes: {
        ...result.routes,
        items: result.routes.items.map((item) => ({
          routingModelKey: item.routingModelKey,
          provider: item.provider,
          providerModel: item.providerModel,
          operation: item.operation,
          summary: toMetricsSummary(item),
          actualTrafficShare: item.routingModelRequestCount
            ? roundTwo((item.requestCount / item.routingModelRequestCount) * 100)
            : 0,
        })),
      },
      crossMetrics: {
        ...result.cross,
        items: result.cross.items.map((item) => ({
          provider: item.provider,
          providerModel: item.providerModel,
          operation: item.operation,
          summary: toMetricsSummary(item),
        })),
      },
      runtime,
      routingConfigChangedWithinRange:
        result.routingConfigRevisions.length > 1 ||
        Boolean(query.configRevision && result.routingConfigRevisions.some((revision) => revision !== query.configRevision)) ||
        isWithinWindow(query.configUpdatedAt, window.from, window.to),
    };
  }

  async getModelDetail(
    config: LlmServiceConfig,
    modelKey: string,
    range: LlmMetricsRange,
    now = new Date(),
    provider?: string,
  ): Promise<AdminLlmModelMetricsDocument> {
    const configuredModel = config.models.find((item) => item.key === modelKey);
    const overview = await this.getOverview(config, range, now, {
      provider,
      ...(configuredModel ? { routingModelKey: modelKey } : { providerModel: modelKey }),
    });
    return {
      generatedAt: overview.generatedAt,
      dataAvailableSince: overview.dataAvailableSince,
      timezone: overview.timezone,
      range,
      granularity: overview.granularity,
      provider,
      modelKey,
      label: configuredModel?.label ?? modelKey,
      summary: overview.summary,
      items: overview.items,
      routes: overview.routes.items
        .filter((item) => configuredModel ? item.routingModelKey === modelKey : item.providerModel === modelKey)
        .filter((item) => provider ? item.provider === provider : true),
    };
  }

  private assertKnownProvider(config: LlmServiceConfig, provider?: string): void {
    if (!provider || config.providers.some((item) => item.key === provider)) return;
    badRequest("REQ_INVALID_QUERY", `Unknown provider: ${provider}.`);
  }
}

function toMetricsSummary(
  aggregate: LlmObservationAggregate,
  includeLatency = true,
): LlmMetricsSummary {
  const reliabilityDenominator = aggregate.successCount + aggregate.failureCount + aggregate.timeoutCount;
  return {
    requestCount: aggregate.requestCount,
    successCount: aggregate.successCount,
    failureCount: aggregate.failureCount,
    timeoutCount: aggregate.timeoutCount,
    cancelledCount: aggregate.cancelledCount,
    successRate: reliabilityDenominator
      ? roundTwo((aggregate.successCount / reliabilityDenominator) * 100)
      : 100,
    latencySampleCount: aggregate.latencySampleCount,
    firstResponseSampleCount: aggregate.firstResponseSampleCount,
    avgFirstByteLatencyMs: includeLatency ? aggregate.avgFirstResponseLatencyMs : undefined,
    avgTotalLatencyMs: includeLatency ? aggregate.avgTotalLatencyMs : undefined,
    p50FirstByteLatencyMs: includeLatency ? aggregate.p50FirstResponseLatencyMs : undefined,
    p95FirstByteLatencyMs: includeLatency ? aggregate.p95FirstResponseLatencyMs : undefined,
    p50TotalLatencyMs: includeLatency ? aggregate.p50TotalLatencyMs : undefined,
    p95TotalLatencyMs: includeLatency ? aggregate.p95TotalLatencyMs : undefined,
    promptTokens: aggregate.promptTokens,
    visibleOutputTokens: aggregate.visibleOutputTokens,
    reasoningTokens: aggregate.reasoningTokens,
    unclassifiedTokens: aggregate.unclassifiedTokens,
    totalTokens: aggregate.totalTokens,
    providerUsageCount: aggregate.providerUsageCount,
    estimatedUsageCount: aggregate.estimatedUsageCount,
    missingUsageCount: aggregate.missingUsageCount,
  };
}

function buildTimeline(
  keys: string[],
  timeline: Array<{ bucket: string } & LlmObservationAggregate>,
  dataAvailableSince?: string,
  granularity: "hour" | "day" = "hour",
  includeLatency = true,
): LlmHourlySeriesItem[] {
  const byBucket = new Map(timeline.map((item) => [item.bucket, item]));
  const availableBucket = dataAvailableSince
    ? granularity === "hour"
      ? toHourKey(new Date(dataAvailableSince), DEFAULT_TIMEZONE)
      : toDateKey(new Date(dataAvailableSince), DEFAULT_TIMEZONE)
    : undefined;
  return keys.map((bucket) => {
    const aggregate = byBucket.get(bucket);
    return {
      bucket,
      available: Boolean(aggregate) || Boolean(availableBucket && bucket >= availableBucket),
      ...toMetricsSummary(aggregate ?? emptyAggregate(), includeLatency),
    };
  });
}

function buildMetricsWindow(range: LlmMetricsRange, now: Date): {
  from: Date;
  to: Date;
  granularity: "hour" | "day";
  keys: string[];
} {
  if (range === "24h" || range === "48h") {
    const count = range === "24h" ? 24 : 48;
    const start = new Date(now);
    start.setUTCMinutes(0, 0, 0);
    start.setTime(start.getTime() - (count - 1) * 60 * 60 * 1000);
    return {
      from: start,
      to: new Date(now.getTime() + 1),
      granularity: "hour",
      keys: Array.from({ length: count }, (_, index) =>
        toHourKey(new Date(start.getTime() + index * 60 * 60 * 1000), DEFAULT_TIMEZONE),
      ),
    };
  }
  const count = range === "7d" ? 7 : range === "30d" ? 30 : 0;
  if (!count) badRequest("REQ_INVALID_QUERY", `Unsupported LLM metrics range: ${range}`);
  const today = toDateKey(now, DEFAULT_TIMEZONE);
  const start = new Date(`${today}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() - (count - 1));
  return {
    from: start,
    to: new Date(now.getTime() + 1),
    granularity: "day",
    keys: Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      return toDateKey(date, DEFAULT_TIMEZONE);
    }),
  };
}

function emptyAggregate(): LlmObservationAggregate {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    latencySampleCount: 0,
    firstResponseSampleCount: 0,
    providerUsageCount: 0,
    estimatedUsageCount: 0,
    missingUsageCount: 0,
  };
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function isWithinWindow(value: string | undefined, from: Date, to: Date): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= from.getTime() && timestamp < to.getTime();
}

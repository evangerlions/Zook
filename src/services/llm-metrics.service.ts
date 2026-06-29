import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  LlmHourlySeriesItem,
  LlmModelMetricsGroup,
  LlmModelRouteConfig,
  LlmMetricsRange,
  LlmMetricsSummary,
  LlmProviderMetricsOption,
  LlmRouteMetricsGroup,
  LlmServiceConfig,
  LlmModelConfig,
} from "../shared/types.ts";
import { badRequest } from "../shared/errors.ts";
import { toHourKey } from "../shared/utils.ts";
import {
  createAiNovelMetricModels,
  isAiNovelSceneRouteKey,
} from "./ai-novel-llm-model-aliases.ts";
import type { LLMUsage } from "./llm-manager.ts";
import {
  createEmptyMetricBucket as createEmptyBucket,
  mergeMetricBuckets as mergeBuckets,
  toHourlySeriesItem,
  toMetricSummary as toSummary,
  type LlmMetricBucket,
} from "./llm-metrics-buckets.ts";

const METRICS_RETENTION_HOURS = 24 * 365;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const METRICS_INDEX_KEY = "index";

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

  async getOverview(
    config: LlmServiceConfig,
    range: LlmMetricsRange,
    now = new Date(),
    provider?: string,
  ): Promise<AdminLlmMetricsDocument> {
    this.assertKnownProvider(config, provider);
    const hours = buildHourKeys(range, now);
    const metricModels = this.getMetricModels(config);
    const models = await Promise.all(
      metricModels.map((model) => this.buildModelMetricsGroup(model, hours, provider)),
    );
    const summary = provider
      ? this.summarizeBuckets(await this.readAggregatedProviderBuckets(metricModels, provider, hours), hours)
      : this.summarizeBuckets(await this.readBuckets(this.globalScope(), hours), hours);

    return {
      timezone: DEFAULT_TIMEZONE,
      range,
      provider,
      summary,
      providers: this.getMetricProviderOptions(config, metricModels),
      models: this.sortModelGroups(models),
    };
  }

  async getModelDetail(
    config: LlmServiceConfig,
    modelKey: string,
    range: LlmMetricsRange,
    now = new Date(),
    provider?: string,
  ): Promise<AdminLlmModelMetricsDocument> {
    this.assertKnownProvider(config, provider);
    const model = this.getMetricModels(config).find((item) => item.key === modelKey);
    if (!model) {
      badRequest("REQ_INVALID_QUERY", `Unknown modelKey: ${modelKey}.`);
    }

    const hours = buildHourKeys(range, now);
    const routeConfigs = this.filterRoutesByProvider(model.routes, provider);
    const summary = provider
      ? this.summarizeBuckets(await this.readAggregatedRouteBuckets(model.key, routeConfigs, hours), hours)
      : this.summarizeBuckets(await this.readBuckets(this.modelScope(model.key), hours), hours);
    const routes = await Promise.all(
      routeConfigs.map(async (route) => ({
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
      provider,
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
    return this.toSeries(buckets, hours);
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

  private async buildModelMetricsGroup(
    model: LlmModelConfig,
    hours: string[],
    provider?: string,
  ): Promise<LlmModelMetricsGroup> {
    const routeConfigs = this.filterRoutesByProvider(model.routes, provider);
    if (provider) {
      const buckets = await this.readAggregatedRouteBuckets(model.key, routeConfigs, hours);
      return {
        modelKey: model.key,
        label: model.label,
        summary: this.summarizeBuckets(buckets, hours),
        items: this.toSeries(buckets, hours),
      };
    }

    return {
      modelKey: model.key,
      label: model.label,
      summary: this.summarizeBuckets(await this.readBuckets(this.modelScope(model.key), hours), hours),
      items: await this.readSeries(this.modelScope(model.key), hours),
    };
  }

  private async readAggregatedRouteBuckets(
    modelKey: string,
    routes: LlmModelRouteConfig[],
    hours: string[],
  ): Promise<Map<string, LlmMetricBucket>> {
    const routeBuckets = await Promise.all(
      routes.map((route) => this.readBuckets(this.routeScope(modelKey, route.provider, route.providerModel), hours)),
    );
    return this.mergeBucketMaps(routeBuckets, hours);
  }

  private async readAggregatedProviderBuckets(
    models: LlmModelConfig[],
    provider: string,
    hours: string[],
  ): Promise<Map<string, LlmMetricBucket>> {
    const routeBuckets = await Promise.all(
      models.flatMap((model) =>
        this.filterRoutesByProvider(model.routes, provider)
          .map((route) => this.readBuckets(this.routeScope(model.key, route.provider, route.providerModel), hours)),
      ),
    );
    return this.mergeBucketMaps(routeBuckets, hours);
  }

  private mergeBucketMaps(bucketMaps: Array<Map<string, LlmMetricBucket>>, hours: string[]): Map<string, LlmMetricBucket> {
    const merged = new Map<string, LlmMetricBucket>();
    for (const buckets of bucketMaps) {
      for (const hour of hours) {
        const bucket = buckets.get(hour);
        if (!bucket) {
          continue;
        }
        merged.set(hour, mergeBuckets(merged.get(hour) ?? createEmptyBucket(hour), bucket));
      }
    }
    return merged;
  }

  private toSeries(buckets: Map<string, LlmMetricBucket>, hours: string[]): LlmHourlySeriesItem[] {
    return hours.map((hour) => toHourlySeriesItem(buckets.get(hour) ?? createEmptyBucket(hour)));
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

  private sortModelGroups(models: LlmModelMetricsGroup[]): LlmModelMetricsGroup[] {
    return [...models].sort((left, right) => {
      const countDelta = right.summary.requestCount - left.summary.requestCount;
      if (countDelta !== 0) {
        return countDelta;
      }
      return left.label.localeCompare(right.label);
    });
  }

  private getMetricProviderOptions(
    config: LlmServiceConfig,
    metricModels: LlmModelConfig[],
  ): LlmProviderMetricsOption[] {
    const providerKeys = new Set(metricModels.flatMap((model) => model.routes.map((route) => route.provider)));
    return config.providers
      .filter((provider) => providerKeys.has(provider.key))
      .map((provider) => ({
        provider: provider.key,
        label: provider.label || provider.key,
      }));
  }

  private filterRoutesByProvider(
    routes: LlmModelRouteConfig[],
    provider?: string,
  ): LlmModelRouteConfig[] {
    if (!provider) {
      return routes;
    }
    return routes.filter((route) => route.provider === provider);
  }

  private assertKnownProvider(config: LlmServiceConfig, provider?: string): void {
    if (!provider) {
      return;
    }
    if (config.providers.some((item) => item.key === provider)) {
      return;
    }
    badRequest("REQ_INVALID_QUERY", `Unknown provider: ${provider}.`);
  }

  private getMetricModels(config: LlmServiceConfig): LlmServiceConfig["models"] {
    const providerKeys = new Set(config.providers.map((provider) => provider.key));
    const concreteModels = config.models.filter((model) => !isAiNovelSceneRouteKey(model.key));
    const existingKeys = new Set(concreteModels.map((model) => model.key));
    const configuredAiNovelMetricModels = this.createConfiguredAiNovelMetricModels(config, existingKeys);
    for (const model of configuredAiNovelMetricModels) {
      existingKeys.add(model.key);
    }
    const aiNovelMetricModels = createAiNovelMetricModels().filter((model) => {
      if (existingKeys.has(model.key)) {
        return false;
      }
      return model.routes.every((route) => providerKeys.has(route.provider));
    });
    return [
      ...concreteModels,
      ...configuredAiNovelMetricModels,
      ...aiNovelMetricModels,
    ];
  }

  private createConfiguredAiNovelMetricModels(
    config: LlmServiceConfig,
    existingKeys: Set<string>,
  ): LlmModelConfig[] {
    const providerKeys = new Set(config.providers.map((provider) => provider.key));
    const modelsByKey = new Map<string, LlmModelConfig>();
    for (const sceneRouteModel of config.models) {
      if (!isAiNovelSceneRouteKey(sceneRouteModel.key)) {
        continue;
      }
      for (const route of sceneRouteModel.routes) {
        if (!providerKeys.has(route.provider)) {
          continue;
        }
        const metricModelKey = route.providerModel.trim();
        if (!metricModelKey || existingKeys.has(metricModelKey)) {
          continue;
        }
        const existing = modelsByKey.get(metricModelKey);
        if (existing) {
          if (
            !existing.routes.some(
              (item) =>
                item.provider === route.provider &&
                item.providerModel === route.providerModel,
            )
          ) {
            existing.routes.push({ ...route });
          }
          continue;
        }
        modelsByKey.set(metricModelKey, {
          key: metricModelKey,
          label: metricModelKey,
          kind: sceneRouteModel.kind,
          strategy: "fixed",
          routes: [{ ...route }],
        });
      }
    }
    return [...modelsByKey.values()];
  }
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

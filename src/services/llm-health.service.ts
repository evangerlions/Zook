import type { LlmObservabilityStore, LlmOperation } from "../infrastructure/database/llm-observability-store.ts";
import type {
  LlmModelConfig,
  LlmModelRuntimeStatus,
  LlmProviderConfig,
} from "../shared/types.ts";
import {
  evaluateLlmRoutes,
  roundRoutingValue,
} from "./llm-routing-score.ts";

const HEALTH_MIN_CALLS = 10;

export interface LlmRouteRef {
  modelKey: string;
  provider: string;
  providerModel: string;
  operation?: LlmOperation;
}

export interface LlmRouteHealthSnapshot {
  totalCalls: number;
  sampleSize: number;
  successRate: number;
  healthScore: number;
  lastErrorAt?: string;
}

export class LlmHealthService {
  constructor(
    private readonly store: LlmObservabilityStore,
    private readonly runtimeProviderKeys?: Partial<Record<LlmOperation, Set<string>>>,
  ) {}

  async getRouteSnapshot(route: LlmRouteRef): Promise<LlmRouteHealthSnapshot> {
    const record = await this.store.getRouteHealth({
      routingModelKey: route.modelKey,
      provider: route.provider,
      providerModel: route.providerModel,
      operation: route.operation ?? "chat",
    });
    if (!record) {
      return emptyHealthSnapshot();
    }
    const sampleSize = record.recentOutcomes.length;
    const successCount = record.recentOutcomes.filter(Boolean).length;
    const successRate = sampleSize
      ? roundRoutingValue((successCount / sampleSize) * 100)
      : 100;
    return {
      totalCalls: record.totalCalls,
      sampleSize,
      successRate,
      healthScore: record.totalCalls < HEALTH_MIN_CALLS ? 100 : successRate,
      lastErrorAt: record.lastErrorAt,
    };
  }

  async buildModelRuntimeStatus(
    model: LlmModelConfig,
    providers: LlmProviderConfig[] = [],
    runtimeProviderKeys?: Partial<Record<LlmOperation, Set<string>>>,
  ): Promise<LlmModelRuntimeStatus> {
    const availableProviderKeys = (runtimeProviderKeys ?? this.runtimeProviderKeys)?.[model.kind];
    const providersByKey = new Map(providers.map((provider) => [provider.key, provider]));
    const health = await Promise.all(model.routes.map((route) => this.getRouteSnapshot({
      modelKey: model.key,
      provider: route.provider,
      providerModel: route.providerModel,
      operation: model.kind,
    })));
    const evaluation = evaluateLlmRoutes(
      model.strategy,
      model.routes.map((route, index) => ({
        route,
        providerEnabled: providersByKey.get(route.provider)?.enabled ?? true,
        runtimeAvailable: availableProviderKeys?.has(route.provider) ?? true,
        healthScore: health[index]?.healthScore ?? 100,
      })),
    );

    return {
      key: model.key,
      kind: model.kind,
      strategy: model.strategy,
      routes: evaluation.routes.map((route, index) => ({
        provider: route.route.provider,
        providerModel: route.route.providerModel,
        enabled: route.route.enabled,
        providerEnabled: providersByKey.get(route.route.provider)?.enabled ?? true,
        selectionEligible: route.selectionEligible,
        runtimeAvailable: route.runtimeAvailable,
        ineligibleReason: route.ineligibleReason,
        weight: route.route.weight,
        configuredWeight: route.configuredWeight,
        sampleSize: health[index]?.sampleSize ?? 0,
        successRate: health[index]?.successRate ?? 100,
        healthScore: health[index]?.healthScore ?? 100,
        dynamicScore: roundRoutingValue(route.dynamicScore),
        effectiveProbability: roundRoutingValue(route.effectiveProbability),
        selectionReason: route.selectionReason,
        selected: route.selected,
        lastErrorAt: health[index]?.lastErrorAt,
      })),
    };
  }
}

function emptyHealthSnapshot(): LlmRouteHealthSnapshot {
  return {
    totalCalls: 0,
    sampleSize: 0,
    successRate: 100,
    healthScore: 100,
  };
}

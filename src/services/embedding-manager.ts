import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmHealthService, LlmRouteRef } from "./llm-health.service.ts";
import type { LlmMetricsService } from "./llm-metrics.service.ts";
import type {
  LLMManagerOptions,
  LLMProviderName,
  LLMUsage,
  LlmRoutingIdentity,
  ResolvedLLMModel,
} from "./llm-manager.ts";
import { estimateEmbeddingUsage } from "./llm-usage-estimator.ts";
import {
  hasStableLlmRoutingInputs,
  resolveLlmRoutingUnit,
} from "./llm-routing-affinity.ts";
import { ApplicationError, badRequest, internalError } from "../shared/errors.ts";
import type { LlmModelConfig, LlmProviderConfig, LlmServiceConfig } from "../shared/types.ts";
import { evaluateLlmRoutes, selectLlmRoute } from "./llm-routing-score.ts";

export interface EmbeddingRequest {
  modelKey: string;
  input: string[];
  providerOptions?: Record<string, unknown>;
  usageOwner?: {
    appId: string;
    userId: string;
  };
  routingIdentity?: LlmRoutingIdentity;
}

export interface EmbeddingVector {
  index: number;
  embedding: number[];
}

export interface EmbeddingResult {
  provider: LLMProviderName;
  modelKey: string;
  providerModel: string;
  vectors: EmbeddingVector[];
  usage?: LLMUsage;
  providerRequestId?: string;
}

export interface ResolvedEmbeddingRequest extends Omit<
  EmbeddingRequest,
  "modelKey" | "routingIdentity"
> {
  model: ResolvedLLMModel;
}

export interface EmbeddingProvider {
  embed(request: ResolvedEmbeddingRequest): Promise<EmbeddingResult>;
}

export type EmbeddingModelRegistry = Record<
  string,
  {
    provider: LLMProviderName;
    providerModel: string;
  }
>;

export const DEFAULT_EMBEDDING_MODEL_REGISTRY: EmbeddingModelRegistry = {
  "novel-embedding": {
    provider: "bailian",
    providerModel: "text-embedding-v4",
  },
};

export class EmbeddingManager {
  constructor(
    private readonly providers: Record<LLMProviderName, EmbeddingProvider>,
    private readonly modelRegistry: EmbeddingModelRegistry = DEFAULT_EMBEDDING_MODEL_REGISTRY,
    private readonly options: LLMManagerOptions = {},
  ) {}

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const resolution = await this.resolveRequest(request);
    const startedAt = this.getNow();
    const observation = this.startObservation(resolution, startedAt);

    try {
      const result = await this.providers[resolution.request.model.provider].embed(resolution.request);
      const usage = result.usage ?? estimateEmbeddingUsage(resolution.request.input);
      const completedAt = this.getNow();
      await observation?.finalize({ usage, completedAt });
      await this.recordOwnedUsage(resolution.request.usageOwner, usage, completedAt);
      return {
        ...result,
        usage,
        provider: resolution.request.model.provider,
        modelKey: resolution.request.model.modelKey,
        providerModel: resolution.request.model.providerModel,
      };
    } catch (error) {
      const completedAt = this.getNow();
      await observation?.finalize({ error, completedAt });
      throw error;
    }
  }

  private async resolveRequest(
    request: EmbeddingRequest,
  ): Promise<{
    request: ResolvedEmbeddingRequest;
    routeRef: LlmRouteRef;
    routingConfigRevision?: number;
  }> {
    const modelKey = request.modelKey.trim();
    if (!modelKey) {
      badRequest("LLM_MODEL_NOT_FOUND", "Embedding modelKey is required.");
    }

    if (!Array.isArray(request.input) || request.input.length === 0) {
      badRequest("AI_EMBEDDING_INPUT_INVALID", "input must be a non-empty string array.");
    }

    const input = request.input.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        badRequest("AI_EMBEDDING_INPUT_INVALID", "input must contain non-empty strings only.");
      }
      return item.trim();
    });

    const runtimeSnapshot = await this.options.commonLlmConfigService?.getRuntimeConfigSnapshot();
    if (runtimeSnapshot) {
      const commonConfig = runtimeSnapshot.config;
      if (!commonConfig.enabled) {
        throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "LLM service is not enabled.");
      }

      const selection = await this.resolveConfiguredModel(
        commonConfig,
        modelKey,
        request.routingIdentity,
      );
      const healthRouteRef = {
        modelKey: selection.routeModelKey,
        provider: selection.provider.key,
        providerModel: selection.route.providerModel,
        operation: "embedding" as const,
      };
      const { routingIdentity: _routingIdentity, ...providerRequest } = request;
      void _routingIdentity;
      return {
        request: {
          ...providerRequest,
          input,
          model: {
            provider: selection.provider.key,
            modelKey,
            resolvedModelKey: selection.routeModelKey,
            providerModel: selection.route.providerModel,
            providerConfig: {
              baseUrl: selection.provider.baseUrl,
              apiKey: selection.provider.apiKey,
              timeoutMs: selection.provider.timeoutMs,
            },
          },
        },
        routeRef: healthRouteRef,
        routingConfigRevision: runtimeSnapshot.revision,
      };
    }

    const resolvedModel = this.modelRegistry[modelKey];
    if (!resolvedModel) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown embedding modelKey: ${request.modelKey}.`);
    }

    if (!this.providers[resolvedModel.provider]) {
      internalError(`Embedding provider ${resolvedModel.provider} is not configured.`);
    }

    const { routingIdentity: _routingIdentity, ...providerRequest } = request;
    void _routingIdentity;
    return {
      request: {
        ...providerRequest,
        input,
        model: {
          provider: resolvedModel.provider,
          modelKey,
          resolvedModelKey: modelKey,
          providerModel: resolvedModel.providerModel,
        },
      },
      routeRef: {
        modelKey,
        provider: resolvedModel.provider,
        providerModel: resolvedModel.providerModel,
        operation: "embedding",
      },
    };
  }

  private async resolveConfiguredModel(
    config: LlmServiceConfig,
    modelKey: string,
    routingIdentity?: LlmRoutingIdentity,
  ): Promise<{
    provider: LlmProviderConfig;
    route: LlmModelConfig["routes"][number];
    routeModelKey: string;
  }> {
    const routeModelKey = modelKey;
    const model = config.models.find((item) => item.key === routeModelKey);

    if (!model) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown embedding modelKey: ${modelKey}.`);
    }

    if (model.kind !== "embedding") {
      badRequest("LLM_MODEL_NOT_FOUND", `LLM modelKey ${routeModelKey} is not configured as an embedding model.`);
    }

    const providerMap = new Map(config.providers.map((item) => [item.key, item]));
    const stableIdentity = hasStableLlmRoutingInputs(
      routingIdentity?.did,
      routingIdentity?.uid,
    );
    const healthSnapshots = await Promise.all(model.routes.map((route) =>
      this.options.llmHealthService?.getRouteSnapshot({
        modelKey: model.key,
        provider: route.provider,
        providerModel: route.providerModel,
        operation: "embedding",
      }),
    ));
    const evaluation = evaluateLlmRoutes(
      model.strategy,
      model.routes.map((route, index) => ({
        route,
        providerEnabled: providerMap.get(route.provider)?.enabled ?? false,
        runtimeAvailable: Boolean(this.providers[route.provider]),
        healthScore: stableIdentity
          ? 100
          : healthSnapshots[index]?.healthScore ?? 100,
      })),
    );
    const routingUnit = stableIdentity
      ? resolveLlmRoutingUnit(routingIdentity?.did, routingIdentity?.uid)
      : this.options.random?.() ??
        resolveLlmRoutingUnit(routingIdentity?.did, routingIdentity?.uid);
    const chosenRoute = selectLlmRoute(evaluation, () => routingUnit)?.route;
    if (!chosenRoute) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Model ${model.key} does not have a routable provider.`,
      );
    }

    const provider = providerMap.get(chosenRoute.provider);
    if (!provider || !this.providers[provider.key]) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Embedding provider ${chosenRoute.provider} is not available in the current runtime.`,
      );
    }

    return {
      provider,
      route: chosenRoute,
      routeModelKey: model.key,
    };
  }

  private startObservation(
    resolution: Awaited<ReturnType<EmbeddingManager["resolveRequest"]>>,
    startedAt: Date,
  ) {
    const recorder = this.options.llmCallObservationRecorder ??
      this.options.llmMetricsService?.observationRecorder;
    const route = resolution.routeRef;
    return recorder?.start({
      routingModelKey: route.modelKey,
      provider: route.provider,
      providerModel: route.providerModel,
      operation: "embedding",
      responseMode: "non_stream",
      routingConfigRevision: resolution.routingConfigRevision,
      startedAt,
      now: this.options.now,
    });
  }


  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async recordOwnedUsage(
    owner: EmbeddingRequest["usageOwner"],
    usage: LLMUsage,
    occurredAt: Date,
  ): Promise<void> {
    if (!owner) {
      return;
    }
    try {
      await this.options.usageRecorder?.({
        appId: owner.appId,
        userId: owner.userId,
        usage,
        occurredAt,
      });
    } catch (error) {
      try {
        this.options.usageRecorderErrorHandler?.({
          appId: owner.appId,
          userId: owner.userId,
          usage,
          occurredAt,
          error,
        });
      } catch {
        // Usage accounting must never break an otherwise successful embedding.
      }
    }
  }
}

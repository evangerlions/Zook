import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmHealthService, LlmRouteRef } from "./llm-health.service.ts";
import type { LlmMetricsService } from "./llm-metrics.service.ts";
import type { LLMManagerOptions, LLMProviderName, LLMUsage, ResolvedLLMModel } from "./llm-manager.ts";
import { estimateEmbeddingUsage } from "./llm-usage-estimator.ts";
import {
  isAiNovelSceneRouteKey,
  resolveAiNovelSceneRouteAlias,
} from "./ai-novel-llm-model-aliases.ts";
import { ApplicationError, badRequest, internalError } from "../shared/errors.ts";
import type { LlmModelConfig, LlmProviderConfig, LlmServiceConfig } from "../shared/types.ts";

export interface EmbeddingRequest {
  modelKey: string;
  modelKeyKind?: "model" | "scene_route";
  input: string[];
  providerOptions?: Record<string, unknown>;
  usageOwner?: {
    appId: string;
    userId: string;
  };
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

export interface ResolvedEmbeddingRequest extends Omit<EmbeddingRequest, "modelKey"> {
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

    try {
      const result = await this.providers[resolution.request.model.provider].embed(resolution.request);
      const usage = result.usage ?? estimateEmbeddingUsage(resolution.request.input);
      const completedAt = this.getNow();
      const totalLatencyMs = completedAt.getTime() - startedAt.getTime();
      await this.recordRouteResult(resolution.routeRefs, {
        ok: true,
        totalLatencyMs,
        usage,
        occurredAt: completedAt,
      });
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
      await this.recordRouteResult(resolution.routeRefs, {
        ok: false,
        totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
        occurredAt: completedAt,
      });
      throw error;
    }
  }

  private async resolveRequest(
    request: EmbeddingRequest,
  ): Promise<{
    request: ResolvedEmbeddingRequest;
    routeRefs: {
      healthRouteRef: LlmRouteRef;
      metricRouteRef: LlmRouteRef;
    };
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

    const commonConfig = await this.options.commonLlmConfigService?.getRuntimeConfig();
    if (await this.options.commonLlmConfigService?.hasStoredConfig()) {
      if (!commonConfig?.enabled) {
        throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "LLM service is not enabled.");
      }

      const selection = await this.resolveConfiguredModel(
        commonConfig,
        modelKey,
        request.modelKeyKind,
      );
      const healthRouteRef = {
        modelKey: selection.routeModelKey,
        provider: selection.provider.key,
        providerModel: selection.route.providerModel,
      };
      return {
        request: {
          ...request,
          input,
          model: {
            provider: selection.provider.key,
            modelKey,
            modelKeyKind: request.modelKeyKind,
            resolvedModelKey: selection.routeModelKey,
            providerModel: selection.route.providerModel,
            providerConfig: {
              baseUrl: selection.provider.baseUrl,
              apiKey: selection.provider.apiKey,
              timeoutMs: selection.provider.timeoutMs,
            },
          },
        },
        routeRefs: this.buildRouteRefs(healthRouteRef, modelKey, request.modelKeyKind),
      };
    }

    const resolvedModel = this.modelRegistry[modelKey];
    if (!resolvedModel) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown embedding modelKey: ${request.modelKey}.`);
    }

    if (!this.providers[resolvedModel.provider]) {
      internalError(`Embedding provider ${resolvedModel.provider} is not configured.`);
    }

    return {
      request: {
        ...request,
        input,
        model: {
          provider: resolvedModel.provider,
          modelKey,
          modelKeyKind: request.modelKeyKind,
          resolvedModelKey: modelKey,
          providerModel: resolvedModel.providerModel,
        },
      },
      routeRefs: this.buildRouteRefs(
        {
          modelKey,
          provider: resolvedModel.provider,
          providerModel: resolvedModel.providerModel,
        },
        modelKey,
        request.modelKeyKind,
      ),
    };
  }

  private buildRouteRefs(
    healthRouteRef: LlmRouteRef,
    requestedModelKey: string,
    modelKeyKind?: "model" | "scene_route",
  ): {
    healthRouteRef: LlmRouteRef;
    metricRouteRef: LlmRouteRef;
  } {
    const metricModelKey = modelKeyKind === "scene_route" || isAiNovelSceneRouteKey(requestedModelKey)
      ? healthRouteRef.providerModel
      : healthRouteRef.modelKey;
    return {
      healthRouteRef,
      metricRouteRef: {
        ...healthRouteRef,
        modelKey: metricModelKey,
      },
    };
  }

  private async resolveConfiguredModel(
    config: LlmServiceConfig,
    modelKey: string,
    modelKeyKind?: "model" | "scene_route",
  ): Promise<{
    provider: LlmProviderConfig;
    route: LlmModelConfig["routes"][number];
    routeModelKey: string;
  }> {
    const alias =
      modelKeyKind === "scene_route" ? resolveAiNovelSceneRouteAlias(modelKey) : undefined;
    const routeModelKey = alias?.kind === "embedding" ? alias.modelKey : modelKey;
    const model = config.models.find((item) => item.key === routeModelKey);

    if (!model) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown embedding modelKey: ${modelKey}.`);
    }

    if (model.kind !== "embedding") {
      badRequest("LLM_MODEL_NOT_FOUND", `LLM modelKey ${routeModelKey} is not configured as an embedding model.`);
    }

    const providerMap = new Map(config.providers.map((item) => [item.key, item]));
    const chosenRoute =
      model.strategy === "fixed"
        ? this.selectFixedRoute(model, providerMap)
        : await this.selectAutoRoute(model, providerMap);

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

  private selectFixedRoute(
    model: LlmModelConfig,
    providerMap: Map<string, LlmProviderConfig>,
  ): LlmModelConfig["routes"][number] {
    const enabledRoutes = model.routes.filter((route) => route.enabled && providerMap.get(route.provider)?.enabled);
    if (enabledRoutes.length) {
      return enabledRoutes.reduce((best, route) => (route.weight > best.weight ? route : best));
    }

    const fallback = model.routes[0];
    if (!fallback) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Model ${model.key} does not contain any routes.`,
      );
    }
    return fallback;
  }

  private async selectAutoRoute(
    model: LlmModelConfig,
    providerMap: Map<string, LlmProviderConfig>,
  ): Promise<LlmModelConfig["routes"][number]> {
    const availableRoutes = model.routes.filter((route) => route.enabled && providerMap.get(route.provider)?.enabled);
    if (!availableRoutes.length) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Model ${model.key} does not have any enabled routes.`,
      );
    }

    const scores = await Promise.all(
      availableRoutes.map(async (route) => {
        const snapshot = await this.options.llmHealthService?.getRouteSnapshot({
          modelKey: model.key,
          provider: route.provider,
          providerModel: route.providerModel,
        });

        return {
          route,
          score: route.weight * ((snapshot?.healthScore ?? 100) / 100),
        };
      }),
    );

    const totalScore = scores.reduce((sum, item) => sum + item.score, 0);
    const weights = totalScore > 0
      ? scores
      : scores.map((item) => ({
          route: item.route,
          score: item.route.weight,
        }));
    const totalWeight = weights.reduce((sum, item) => sum + item.score, 0);

    if (totalWeight <= 0) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Model ${model.key} does not have a routable provider.`,
      );
    }

    const target = (this.options.random ?? Math.random)() * totalWeight;
    let cursor = 0;
    for (const item of weights) {
      cursor += item.score;
      if (target <= cursor) {
        return item.route;
      }
    }

    return weights[weights.length - 1].route;
  }

  private async recordRouteResult(
    routeRefs: {
      healthRouteRef: LlmRouteRef;
      metricRouteRef: LlmRouteRef;
    },
    result: {
      ok: boolean;
      totalLatencyMs: number;
      usage?: LLMUsage;
      occurredAt: Date;
    },
  ): Promise<void> {
    await Promise.all([
      this.options.llmHealthService?.recordResult(routeRefs.healthRouteRef, {
        ok: result.ok,
        timestamp: result.occurredAt.toISOString(),
        firstByteLatencyMs: result.totalLatencyMs,
        totalLatencyMs: result.totalLatencyMs,
      }),
      this.options.llmMetricsService?.recordCall({
        ...routeRefs.metricRouteRef,
        ok: result.ok,
        firstByteLatencyMs: result.totalLatencyMs,
        totalLatencyMs: result.totalLatencyMs,
        usage: result.usage,
        occurredAt: result.occurredAt,
      }),
    ]);
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

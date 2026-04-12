import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmHealthService, LlmRouteRef } from "./llm-health.service.ts";
import type { LlmMetricsService } from "./llm-metrics.service.ts";
import type { LLMManagerOptions, LLMProviderName, LLMUsage, ResolvedLLMModel } from "./llm-manager.ts";
import { selectAutoRoute } from "./llm-route-selector.ts";
import { ApplicationError, badRequest, internalError } from "../shared/errors.ts";
import type { LlmModelConfig, LlmProviderConfig, LlmServiceConfig } from "../shared/types.ts";

export interface EmbeddingRequest {
  modelKey: string;
  input: string[];
  providerOptions?: Record<string, unknown>;
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
      const completedAt = this.getNow();
      const totalLatencyMs = completedAt.getTime() - startedAt.getTime();
      await this.recordRouteResult(resolution.routeRef, {
        ok: true,
        totalLatencyMs,
        usage: result.usage,
        occurredAt: completedAt,
      });
      return {
        ...result,
        provider: resolution.request.model.provider,
        modelKey: resolution.request.model.modelKey,
        providerModel: resolution.request.model.providerModel,
      };
    } catch (error) {
      const completedAt = this.getNow();
      await this.recordRouteResult(resolution.routeRef, {
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
    routeRef: LlmRouteRef;
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

      const selection = await this.resolveConfiguredModel(commonConfig, modelKey);
      return {
        request: {
          ...request,
          input,
          model: {
            provider: selection.provider.key,
            modelKey,
            providerModel: selection.route.providerModel,
            providerConfig: {
              baseUrl: selection.provider.baseUrl,
              apiKey: selection.provider.apiKey,
              timeoutMs: selection.provider.timeoutMs,
            },
          },
        },
        routeRef: {
          modelKey,
          provider: selection.provider.key,
          providerModel: selection.route.providerModel,
        },
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
          providerModel: resolvedModel.providerModel,
        },
      },
      routeRef: {
        modelKey,
        provider: resolvedModel.provider,
        providerModel: resolvedModel.providerModel,
      },
    };
  }

  private async resolveConfiguredModel(
    config: LlmServiceConfig,
    modelKey: string,
  ): Promise<{
    provider: LlmProviderConfig;
    route: LlmModelConfig["routes"][number];
  }> {
    const model = config.models.find((item) => item.key === modelKey);
    if (!model) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown embedding modelKey: ${modelKey}.`);
    }

    if (model.kind !== "embedding") {
      badRequest("LLM_MODEL_NOT_FOUND", `LLM modelKey ${modelKey} is not configured as an embedding model.`);
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
    try {
      return await selectAutoRoute({
        model,
        providerMap,
        random: this.options.random,
        healthProvider: this.options.llmHealthService
          ? {
              getHealthScore: async (route) => {
                const snapshot = await this.options.llmHealthService?.getRouteSnapshot(route);
                return snapshot?.healthScore;
              },
            }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Model ${model.key} does not have a routable provider.`;
      throw new ApplicationError(503, "LLM_ROUTE_NOT_AVAILABLE", message);
    }
  }

  private async recordRouteResult(
    routeRef: LlmRouteRef,
    result: {
      ok: boolean;
      totalLatencyMs: number;
      usage?: LLMUsage;
      occurredAt: Date;
    },
  ): Promise<void> {
    await Promise.all([
      this.options.llmHealthService?.recordResult(routeRef, {
        ok: result.ok,
        timestamp: result.occurredAt.toISOString(),
        firstByteLatencyMs: result.totalLatencyMs,
        totalLatencyMs: result.totalLatencyMs,
      }),
      this.options.llmMetricsService?.recordCall({
        ...routeRef,
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
}

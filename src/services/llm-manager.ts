import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmHealthService, LlmRouteRef } from "./llm-health.service.ts";
import type { LlmMetricsService } from "./llm-metrics.service.ts";
import { ApplicationError, badRequest, internalError } from "../shared/errors.ts";
import type { LlmModelConfig, LlmProviderConfig, LlmServiceConfig } from "../shared/types.ts";

export type LLMProviderName = string;
export type LLMRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMCompletionRequest {
  modelKey: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  providerOptions?: Record<string, unknown>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMCompletionResult {
  provider: LLMProviderName;
  modelKey: string;
  providerModel: string;
  text: string;
  reasoningText?: string;
  finishReason?: string;
  usage?: LLMUsage;
  providerRequestId?: string;
}

export type LLMStreamEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "content_delta"; text: string }
  | { type: "usage"; usage: LLMUsage }
  | { type: "done"; finishReason?: string };

export interface ResolvedLLMModel {
  provider: LLMProviderName;
  modelKey: string;
  providerModel: string;
  providerConfig?: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  };
}

export interface ResolvedLLMCompletionRequest extends Omit<LLMCompletionRequest, "modelKey"> {
  model: ResolvedLLMModel;
}

export interface LLMProvider {
  complete(request: ResolvedLLMCompletionRequest): Promise<LLMCompletionResult>;
  stream(request: ResolvedLLMCompletionRequest): AsyncIterable<LLMStreamEvent>;
}

export type LLMModelRegistry = Record<
  string,
  {
    provider: LLMProviderName;
    providerModel: string;
  }
>;

export const DEFAULT_LLM_MODEL_REGISTRY: LLMModelRegistry = {
  "kimi2.5": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
  "novel-creative": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
  "novel-reasoning": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
  "novel-structured": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
};

const VALID_ROLES = new Set<LLMRole>(["system", "user", "assistant"]);

export interface LLMManagerOptions {
  commonLlmConfigService?: CommonLlmConfigService;
  llmHealthService?: LlmHealthService;
  llmMetricsService?: LlmMetricsService;
  random?: () => number;
  now?: () => Date;
}

export class LLMManager {
  constructor(
    private readonly providers: Record<LLMProviderName, LLMProvider>,
    private readonly modelRegistry: LLMModelRegistry = DEFAULT_LLM_MODEL_REGISTRY,
    private readonly options: LLMManagerOptions = {},
  ) {}

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const resolution = await this.resolveRequest(request);
    const startedAt = this.getNow();

    try {
      const result = await this.providers[resolution.request.model.provider].complete(resolution.request);
      const completedAt = this.getNow();
      const totalLatencyMs = completedAt.getTime() - startedAt.getTime();
      await this.recordRouteResult(resolution.routeRef, {
        ok: true,
        firstByteLatencyMs: totalLatencyMs,
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
      const totalLatencyMs = completedAt.getTime() - startedAt.getTime();
      await this.recordRouteResult(resolution.routeRef, {
        ok: false,
        firstByteLatencyMs: totalLatencyMs,
        totalLatencyMs,
        occurredAt: completedAt,
      });
      throw error;
    }
  }

  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
    const resolution = await this.resolveRequest(request);
    const startedAt = this.getNow();
    let firstByteLatencyMs: number | undefined;
    let usage: LLMUsage | undefined;
    let recorded = false;

    try {
      for await (const event of this.providers[resolution.request.model.provider].stream(resolution.request)) {
        if (
          firstByteLatencyMs === undefined &&
          (event.type === "reasoning_delta" || event.type === "content_delta")
        ) {
          firstByteLatencyMs = this.getNow().getTime() - startedAt.getTime();
        }

        if (event.type === "usage") {
          usage = event.usage;
        }

        if (event.type === "done") {
          const completedAt = this.getNow();
          await this.recordRouteResult(resolution.routeRef, {
            ok: true,
            firstByteLatencyMs: firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
            totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
            usage,
            occurredAt: completedAt,
          });
          recorded = true;
        }

        yield event;
      }

      if (!recorded) {
        const completedAt = this.getNow();
        await this.recordRouteResult(resolution.routeRef, {
          ok: true,
          firstByteLatencyMs: firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
          totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
          usage,
          occurredAt: completedAt,
        });
      }
    } catch (error) {
      const completedAt = this.getNow();
      await this.recordRouteResult(resolution.routeRef, {
        ok: false,
        firstByteLatencyMs: firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
        totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
        usage,
        occurredAt: completedAt,
      });
      throw error;
    }
  }

  private async resolveRequest(
    request: LLMCompletionRequest,
  ): Promise<{
    request: ResolvedLLMCompletionRequest;
    routeRef: LlmRouteRef;
  }> {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      badRequest("REQ_INVALID_BODY", "messages must contain at least one item.");
    }

    const messages = request.messages.map((message) => {
      if (!VALID_ROLES.has(message.role)) {
        badRequest("REQ_INVALID_BODY", `Unsupported LLM role: ${String(message.role)}.`);
      }

      if (typeof message.content !== "string" || !message.content.trim()) {
        badRequest("REQ_INVALID_BODY", "LLM message content must be a non-empty string.");
      }

      return {
        role: message.role,
        content: message.content,
      };
    });

    const requestedModelKey = request.modelKey.trim();
    const commonConfig = await this.options.commonLlmConfigService?.getRuntimeConfig();

    if (this.options.commonLlmConfigService?.hasStoredConfig()) {
      if (!commonConfig?.enabled) {
        throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "LLM service is not enabled.");
      }

      const modelKey = requestedModelKey || commonConfig.defaultModelKey;
      if (!modelKey) {
        throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "LLM default modelKey is not configured.");
      }

      const selection = await this.resolveConfiguredModel(commonConfig, modelKey);
      return {
        request: {
          ...request,
          messages,
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

    const modelKey = requestedModelKey;
    if (!modelKey || !this.modelRegistry[modelKey]) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown LLM modelKey: ${request.modelKey}.`);
    }

    const resolvedModel = this.modelRegistry[modelKey];
    if (!this.providers[resolvedModel.provider]) {
      internalError(`LLM provider ${resolvedModel.provider} is not configured.`);
    }

    return {
      request: {
        ...request,
        messages,
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
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown LLM modelKey: ${modelKey}.`);
    }

    if (model.kind !== "chat") {
      badRequest("LLM_MODEL_NOT_FOUND", `LLM modelKey ${modelKey} is not configured as a chat model.`);
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
        `LLM provider ${chosenRoute.provider} is not available in the current runtime.`,
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
    routeRef: LlmRouteRef,
    result: {
      ok: boolean;
      firstByteLatencyMs: number;
      totalLatencyMs: number;
      usage?: LLMUsage;
      occurredAt: Date;
    },
  ): Promise<void> {
    await Promise.all([
      this.options.llmHealthService?.recordResult(routeRef, {
        ok: result.ok,
        timestamp: result.occurredAt.toISOString(),
        firstByteLatencyMs: result.firstByteLatencyMs,
        totalLatencyMs: result.totalLatencyMs,
      }),
      this.options.llmMetricsService?.recordCall({
        ...routeRef,
        ok: result.ok,
        firstByteLatencyMs: result.firstByteLatencyMs,
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

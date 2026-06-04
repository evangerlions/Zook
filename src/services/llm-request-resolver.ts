import type { LlmRouteRef } from "./llm-health.service.ts";
import {
  isAiNovelSceneRouteKey,
  resolveAiNovelSceneRouteAlias,
} from "./ai-novel-llm-model-aliases.ts";
import type {
  LLMCompletionRequest,
  LLMManagerOptions,
  LLMMessage,
  LLMModelRegistry,
  LLMProvider,
  LLMProviderName,
  LLMRole,
  ResolvedLLMCompletionRequest,
} from "./llm-manager-types.ts";
import {
  ApplicationError,
  badRequest,
  internalError,
} from "../shared/errors.ts";
import type {
  LlmModelConfig,
  LlmProviderConfig,
  LlmServiceConfig,
} from "../shared/types.ts";

const VALID_ROLES = new Set<LLMRole>(["system", "user", "assistant", "tool"]);

export interface ResolvedLlmRequest {
  request: ResolvedLLMCompletionRequest;
  routeRefs: {
    healthRouteRef: LlmRouteRef;
    metricRouteRef: LlmRouteRef;
  };
}

interface LlmRequestResolverOptions {
  providers: Record<LLMProviderName, LLMProvider>;
  modelRegistry: LLMModelRegistry;
  managerOptions: LLMManagerOptions;
}

export class LlmRequestResolver {
  constructor(private readonly options: LlmRequestResolverOptions) {}

  async resolve(request: LLMCompletionRequest): Promise<ResolvedLlmRequest> {
    const messages = this.validateMessages(request.messages);
    const requestedModelKey = request.modelKey.trim();
    const commonConfig =
      await this.options.managerOptions.commonLlmConfigService?.getRuntimeConfig();

    if (await this.options.managerOptions.commonLlmConfigService?.hasStoredConfig()) {
      return this.resolveConfiguredRequest(request, messages, requestedModelKey, commonConfig);
    }

    return this.resolveRegistryRequest(request, messages, requestedModelKey);
  }

  private validateMessages(messagesInput: LLMCompletionRequest["messages"]): LLMMessage[] {
    if (!Array.isArray(messagesInput) || messagesInput.length === 0) {
      badRequest("REQ_INVALID_BODY", "messages must contain at least one item.");
    }

    return messagesInput.map((message) => {
      if (!VALID_ROLES.has(message.role)) {
        badRequest("REQ_INVALID_BODY", `Unsupported LLM role: ${String(message.role)}.`);
      }

      if (message.role === "tool") {
        return this.validateToolMessage(message);
      }

      const hasToolCalls =
        Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
      const reasoningContent =
        message.role === "assistant" && message.reasoningContent?.trim()
          ? message.reasoningContent.trim()
          : undefined;
      if (typeof message.content !== "string") {
        badRequest("REQ_INVALID_BODY", "LLM message content must be a string.");
      }
      if (!hasToolCalls && !reasoningContent && !message.content.trim()) {
        badRequest(
          "REQ_INVALID_BODY",
          "LLM message content must be a non-empty string unless assistant reasoningContent or toolCalls are present.",
        );
      }

      return {
        role: message.role,
        content: message.content,
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(hasToolCalls ? { toolCalls: message.toolCalls } : {}),
      };
    });
  }

  private validateToolMessage(message: LLMMessage): LLMMessage {
    if (typeof message.toolCallId !== "string" || !message.toolCallId.trim()) {
      badRequest("REQ_INVALID_BODY", "tool messages require toolCallId.");
    }
    if (typeof message.content !== "string") {
      badRequest("REQ_INVALID_BODY", "tool message content must be a string.");
    }
    return {
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
    };
  }

  private async resolveConfiguredRequest(
    request: LLMCompletionRequest,
    messages: LLMMessage[],
    requestedModelKey: string,
    commonConfig?: LlmServiceConfig,
  ): Promise<ResolvedLlmRequest> {
    if (!commonConfig?.enabled) {
      throw new ApplicationError(
        503,
        "LLM_SERVICE_NOT_CONFIGURED",
        "LLM service is not enabled.",
      );
    }

    const modelKey = requestedModelKey || commonConfig.defaultModelKey;
    if (!modelKey) {
      throw new ApplicationError(
        503,
        "LLM_SERVICE_NOT_CONFIGURED",
        "LLM default modelKey is not configured.",
      );
    }

    const selection = await this.resolveConfiguredModel(commonConfig, modelKey);
    const healthRouteRef = {
      modelKey,
      provider: selection.provider.key,
      providerModel: selection.route.providerModel,
    };
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
      routeRefs: buildRouteRefs(healthRouteRef, modelKey, request.modelKeyKind),
    };
  }

  private resolveRegistryRequest(
    request: LLMCompletionRequest,
    messages: LLMMessage[],
    modelKey: string,
  ): ResolvedLlmRequest {
    if (!modelKey || !this.options.modelRegistry[modelKey]) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown LLM modelKey: ${request.modelKey}.`);
    }

    const resolvedModel = this.options.modelRegistry[modelKey];
    if (!this.options.providers[resolvedModel.provider]) {
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
      routeRefs: buildRouteRefs(
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

  private async resolveConfiguredModel(
    config: LlmServiceConfig,
    modelKey: string,
  ): Promise<{
    provider: LlmProviderConfig;
    route: LlmModelConfig["routes"][number];
  }> {
    let model = config.models.find((item) => item.key === modelKey);
    if (!model) {
      const alias = resolveAiNovelSceneRouteAlias(modelKey);
      if (alias?.kind === "chat") {
        const provider = config.providers.find((item) => item.key === alias.provider);
        if (provider?.enabled && this.options.providers[provider.key]) {
          return {
            provider,
            route: {
              provider: alias.provider,
              providerModel: alias.providerModel,
              enabled: true,
              weight: 100,
            },
          };
        }
      }
    }

    if (!model) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown LLM modelKey: ${modelKey}.`);
    }

    if (model.kind !== "chat") {
      badRequest(
        "LLM_MODEL_NOT_FOUND",
        `LLM modelKey ${modelKey} is not configured as a chat model.`,
      );
    }

    const providerMap = new Map(config.providers.map((item) => [item.key, item]));
    const chosenRoute =
      model.strategy === "fixed"
        ? selectFixedRoute(model, providerMap)
        : await this.selectAutoRoute(model, providerMap);

    const provider = providerMap.get(chosenRoute.provider);
    if (!provider || !this.options.providers[provider.key]) {
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

  private async selectAutoRoute(
    model: LlmModelConfig,
    providerMap: Map<string, LlmProviderConfig>,
  ): Promise<LlmModelConfig["routes"][number]> {
    const availableRoutes = model.routes.filter(
      (route) => route.enabled && providerMap.get(route.provider)?.enabled,
    );
    if (!availableRoutes.length) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Model ${model.key} does not have any enabled routes.`,
      );
    }

    const scores = await Promise.all(
      availableRoutes.map(async (route) => {
        const snapshot = await this.options.managerOptions.llmHealthService?.getRouteSnapshot({
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
    const weights =
      totalScore > 0
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

    const target = (this.options.managerOptions.random ?? Math.random)() * totalWeight;
    let cursor = 0;
    for (const item of weights) {
      cursor += item.score;
      if (target <= cursor) {
        return item.route;
      }
    }

    return weights[weights.length - 1].route;
  }
}

function buildRouteRefs(
  healthRouteRef: LlmRouteRef,
  requestedModelKey: string,
  modelKeyKind?: "model" | "scene_route",
): {
  healthRouteRef: LlmRouteRef;
  metricRouteRef: LlmRouteRef;
} {
  const metricModelKey =
    modelKeyKind === "scene_route" || isAiNovelSceneRouteKey(requestedModelKey)
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

function selectFixedRoute(
  model: LlmModelConfig,
  providerMap: Map<string, LlmProviderConfig>,
): LlmModelConfig["routes"][number] {
  const enabledRoutes = model.routes.filter(
    (route) => route.enabled && providerMap.get(route.provider)?.enabled,
  );
  if (enabledRoutes.length) {
    return enabledRoutes.reduce((best, route) =>
      route.weight > best.weight ? route : best,
    );
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

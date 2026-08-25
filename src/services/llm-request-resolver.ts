import type { LlmRouteRef } from "./llm-health.service.ts";
import { resolveAiNovelSceneRouteAlias } from "./ai-novel-llm-model-aliases.ts";
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
import { evaluateLlmRoutes, selectLlmRoute } from "./llm-routing-score.ts";

const VALID_ROLES = new Set<LLMRole>(["system", "user", "assistant", "tool"]);

export interface ResolvedLlmRequest {
  request: ResolvedLLMCompletionRequest;
  routeRef: LlmRouteRef;
  routingConfigRevision?: number;
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
    const runtimeSnapshot =
      await this.options.managerOptions.commonLlmConfigService?.getRuntimeConfigSnapshot();

    if (runtimeSnapshot) {
      return this.resolveConfiguredRequest(
        request,
        messages,
        requestedModelKey,
        runtimeSnapshot.config,
        runtimeSnapshot.revision,
      );
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
    commonConfig: LlmServiceConfig,
    routingConfigRevision?: number,
  ): Promise<ResolvedLlmRequest> {
    if (!commonConfig.enabled) {
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

    const selection = await this.resolveConfiguredModel(
      commonConfig,
      modelKey,
      request.modelKeyKind,
    );
    const healthRouteRef = {
      modelKey: selection.routeModelKey,
      provider: selection.provider.key,
      providerModel: selection.route.providerModel,
      operation: "chat" as const,
    };
    return {
      request: {
        ...request,
        messages,
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
      routeRef: healthRouteRef,
      routingConfigRevision,
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
          modelKeyKind: request.modelKeyKind,
          resolvedModelKey: modelKey,
          providerModel: resolvedModel.providerModel,
        },
      },
      routeRef: {
        modelKey,
        provider: resolvedModel.provider,
        providerModel: resolvedModel.providerModel,
        operation: "chat",
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
    const routeModelKey = alias?.kind === "chat" ? alias.modelKey : modelKey;
    const model = config.models.find((item) => item.key === routeModelKey);

    if (!model) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown LLM modelKey: ${modelKey}.`);
    }

    if (model.kind !== "chat") {
      badRequest(
        "LLM_MODEL_NOT_FOUND",
        `LLM modelKey ${routeModelKey} is not configured as a chat model.`,
      );
    }

    const providerMap = new Map(config.providers.map((item) => [item.key, item]));
    const healthSnapshots = await Promise.all(model.routes.map((route) =>
      this.options.managerOptions.llmHealthService?.getRouteSnapshot({
        modelKey: model.key,
        provider: route.provider,
        providerModel: route.providerModel,
        operation: model.kind,
      }),
    ));
    const evaluation = evaluateLlmRoutes(
      model.strategy,
      model.routes.map((route, index) => ({
        route,
        providerEnabled: providerMap.get(route.provider)?.enabled ?? false,
        runtimeAvailable: Boolean(this.options.providers[route.provider]),
        healthScore: healthSnapshots[index]?.healthScore ?? 100,
      })),
    );
    const chosenRoute = selectLlmRoute(
      evaluation,
      this.options.managerOptions.random,
    )?.route;
    if (!chosenRoute) {
      throw new ApplicationError(
        503,
        "LLM_ROUTE_NOT_AVAILABLE",
        `Model ${model.key} does not have a routable provider.`,
      );
    }

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
      routeModelKey: model.key,
    };
  }

}

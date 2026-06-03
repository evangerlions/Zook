import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmHealthService, LlmRouteRef } from "./llm-health.service.ts";
import type { LlmMetricsService } from "./llm-metrics.service.ts";
import {
  isAiNovelSceneRouteKey,
  resolveAiNovelSceneRouteAlias,
} from "./ai-novel-llm-model-aliases.ts";
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

export type LLMProviderName = string;
export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface LLMMessage {
  role: LLMRole;
  content?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMCompletionRequest {
  modelKey: string;
  modelKeyKind?: "model" | "scene_route";
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  providerOptions?: Record<string, unknown>;
}

export interface LLMCompleteViaStreamOptions {
  firstContentTimeoutMs?: number;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextWindowTokens?: number;
  contextUsedRatio?: number;
}

export interface LLMCompletionResult {
  provider: LLMProviderName;
  modelKey: string;
  providerModel: string;
  text: string;
  toolCalls?: LLMToolCall[];
  reasoningText?: string;
  finishReason?: string;
  usage?: LLMUsage;
  providerRequestId?: string;
}

export type LLMStreamEvent = (
  | { type: "reasoning_delta"; text: string }
  | { type: "content_delta"; text: string }
  | { type: "usage"; usage: LLMUsage }
  | {
      type: "tool_call_delta";
      text: string;
      toolCallId?: string;
      toolCallName?: string;
      toolArgumentPath?: string;
    }
  | { type: "tool_call"; toolCall: LLMToolCall }
  | { type: "done"; finishReason?: string }
) & {
  rawEvent?: unknown;
};

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

export interface ResolvedLLMCompletionRequest extends Omit<
  LLMCompletionRequest,
  "modelKey"
> {
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

const VALID_ROLES = new Set<LLMRole>(["system", "user", "assistant", "tool"]);

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
      const result = await this.providers[
        resolution.request.model.provider
      ].complete(resolution.request);
      const usage = this.withContextUsage(
        result.usage,
        resolution.request.model,
      );
      const completedAt = this.getNow();
      const totalLatencyMs = completedAt.getTime() - startedAt.getTime();
      await this.recordRouteResult(resolution.routeRefs, {
        ok: true,
        firstByteLatencyMs: totalLatencyMs,
        totalLatencyMs,
        usage,
        occurredAt: completedAt,
      });
      return {
        ...result,
        usage,
        provider: resolution.request.model.provider,
        modelKey: resolution.request.model.modelKey,
        providerModel: resolution.request.model.providerModel,
      };
    } catch (error) {
      const completedAt = this.getNow();
      const totalLatencyMs = completedAt.getTime() - startedAt.getTime();
      await this.recordRouteResult(resolution.routeRefs, {
        ok: false,
        firstByteLatencyMs: totalLatencyMs,
        totalLatencyMs,
        occurredAt: completedAt,
      });
      throw error;
    }
  }

  async completeViaStream(
    request: LLMCompletionRequest,
    options: LLMCompleteViaStreamOptions = {},
  ): Promise<LLMCompletionResult> {
    const resolution = await this.resolveRequest(request);
    const startedAt = this.getNow();
    let firstByteLatencyMs: number | undefined;
    let usage: LLMUsage | undefined;
    let finishReason: string | undefined;
    let text = "";
    let reasoningText = "";
    const toolCalls: LLMToolCall[] = [];
    const iterator = this.providers[resolution.request.model.provider]
      .stream(resolution.request)
      [Symbol.asyncIterator]();

    try {
      while (true) {
        const next = await this.nextStreamEvent(iterator, {
          firstContentSeen: firstByteLatencyMs !== undefined,
          firstContentTimeoutMs: options.firstContentTimeoutMs,
        });
        if (next.done) {
          break;
        }

        const event = next.value;
        if (
          event.type === "content_delta" ||
          event.type === "reasoning_delta" ||
          event.type === "tool_call_delta" ||
          event.type === "tool_call"
        ) {
          firstByteLatencyMs ??= this.getNow().getTime() - startedAt.getTime();
        }
        if (event.type === "content_delta") {
          text += event.text;
        } else if (event.type === "reasoning_delta") {
          reasoningText += event.text;
        } else if (event.type === "tool_call") {
          toolCalls.push(event.toolCall);
        } else if (event.type === "usage") {
          usage = this.withContextUsage(event.usage, resolution.request.model);
        } else if (event.type === "done") {
          finishReason = event.finishReason;
        }
      }

      const completedAt = this.getNow();
      await this.recordRouteResult(resolution.routeRefs, {
        ok: true,
        firstByteLatencyMs:
          firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
        totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
        usage,
        occurredAt: completedAt,
      });
      return {
        provider: resolution.request.model.provider,
        modelKey: resolution.request.model.modelKey,
        providerModel: resolution.request.model.providerModel,
        text,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(reasoningText ? { reasoningText } : {}),
        ...(finishReason ? { finishReason } : {}),
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      void iterator.return?.();
      const completedAt = this.getNow();
      await this.recordRouteResult(resolution.routeRefs, {
        ok: false,
        firstByteLatencyMs:
          firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
        totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
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
      for await (const event of this.providers[
        resolution.request.model.provider
      ].stream(resolution.request)) {
        if (
          firstByteLatencyMs === undefined &&
          (event.type === "reasoning_delta" ||
            event.type === "content_delta" ||
            event.type === "tool_call_delta" ||
            event.type === "tool_call")
        ) {
          firstByteLatencyMs = this.getNow().getTime() - startedAt.getTime();
        }

        if (event.type === "usage") {
          usage = this.withContextUsage(event.usage, resolution.request.model);
          yield {
            ...event,
            usage,
          };
          continue;
        }

        if (event.type === "done") {
          const completedAt = this.getNow();
          await this.recordRouteResult(resolution.routeRefs, {
            ok: true,
            firstByteLatencyMs:
              firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
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
        await this.recordRouteResult(resolution.routeRefs, {
          ok: true,
          firstByteLatencyMs:
            firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
          totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
          usage,
          occurredAt: completedAt,
        });
      }
    } catch (error) {
      const completedAt = this.getNow();
      await this.recordRouteResult(resolution.routeRefs, {
        ok: false,
        firstByteLatencyMs:
          firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
        totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
        usage,
        occurredAt: completedAt,
      });
      throw error;
    }
  }

  private async nextStreamEvent(
    iterator: AsyncIterator<LLMStreamEvent>,
    options: {
      firstContentSeen: boolean;
      firstContentTimeoutMs?: number;
    },
  ): Promise<IteratorResult<LLMStreamEvent>> {
    if (
      options.firstContentSeen ||
      options.firstContentTimeoutMs === undefined ||
      options.firstContentTimeoutMs <= 0
    ) {
      return iterator.next();
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<LLMStreamEvent>>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new ApplicationError(
                504,
                "LLM_PROVIDER_REQUEST_FAILED",
                "LLM stream did not produce content before the first-byte timeout.",
                {
                  reason: "first_byte_timeout",
                  timeoutMs: options.firstContentTimeoutMs,
                },
              ),
            );
          }, options.firstContentTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async resolveRequest(request: LLMCompletionRequest): Promise<{
    request: ResolvedLLMCompletionRequest;
    routeRefs: {
      healthRouteRef: LlmRouteRef;
      metricRouteRef: LlmRouteRef;
    };
  }> {
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      badRequest(
        "REQ_INVALID_BODY",
        "messages must contain at least one item.",
      );
    }

    const messages = request.messages.map((message) => {
      if (!VALID_ROLES.has(message.role)) {
        badRequest(
          "REQ_INVALID_BODY",
          `Unsupported LLM role: ${String(message.role)}.`,
        );
      }

      if (message.role === "tool") {
        if (
          typeof message.toolCallId !== "string" ||
          !message.toolCallId.trim()
        ) {
          badRequest("REQ_INVALID_BODY", "tool messages require toolCallId.");
        }
        if (typeof message.content !== "string") {
          badRequest(
            "REQ_INVALID_BODY",
            "tool message content must be a string.",
          );
        }
        return {
          role: message.role,
          content: message.content,
          toolCallId: message.toolCallId,
        };
      }

      const hasToolCalls =
        Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
      if (typeof message.content !== "string") {
        badRequest("REQ_INVALID_BODY", "LLM message content must be a string.");
      }
      if (!hasToolCalls && !message.content.trim()) {
        badRequest(
          "REQ_INVALID_BODY",
          "LLM message content must be a non-empty string.",
        );
      }

      return {
        role: message.role,
        content: message.content,
        ...(hasToolCalls ? { toolCalls: message.toolCalls } : {}),
      };
    });

    const requestedModelKey = request.modelKey.trim();
    const commonConfig =
      await this.options.commonLlmConfigService?.getRuntimeConfig();

    if (await this.options.commonLlmConfigService?.hasStoredConfig()) {
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

      const selection = await this.resolveConfiguredModel(
        commonConfig,
        modelKey,
      );
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
        routeRefs: this.buildRouteRefs(
          healthRouteRef,
          modelKey,
          request.modelKeyKind,
        ),
      };
    }

    const modelKey = requestedModelKey;
    if (!modelKey || !this.modelRegistry[modelKey]) {
      badRequest(
        "LLM_MODEL_NOT_FOUND",
        `Unknown LLM modelKey: ${request.modelKey}.`,
      );
    }

    const resolvedModel = this.modelRegistry[modelKey];
    if (!this.providers[resolvedModel.provider]) {
      internalError(
        `LLM provider ${resolvedModel.provider} is not configured.`,
      );
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
    const metricModelKey =
      modelKeyKind === "scene_route" ||
      isAiNovelSceneRouteKey(requestedModelKey)
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
  ): Promise<{
    provider: LlmProviderConfig;
    route: LlmModelConfig["routes"][number];
  }> {
    let model = config.models.find((item) => item.key === modelKey);
    if (!model) {
      const alias = resolveAiNovelSceneRouteAlias(modelKey);
      if (alias?.kind === "chat") {
        const provider = config.providers.find(
          (item) => item.key === alias.provider,
        );
        if (provider?.enabled && this.providers[provider.key]) {
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

    const providerMap = new Map(
      config.providers.map((item) => [item.key, item]),
    );
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
      firstByteLatencyMs: number;
      totalLatencyMs: number;
      usage?: LLMUsage;
      occurredAt: Date;
    },
  ): Promise<void> {
    await Promise.all([
      this.options.llmHealthService?.recordResult(routeRefs.healthRouteRef, {
        ok: result.ok,
        timestamp: result.occurredAt.toISOString(),
        firstByteLatencyMs: result.firstByteLatencyMs,
        totalLatencyMs: result.totalLatencyMs,
      }),
      this.options.llmMetricsService?.recordCall({
        ...routeRefs.metricRouteRef,
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

  private withContextUsage(
    usage: LLMUsage | undefined,
    model: ResolvedLLMModel,
  ): LLMUsage | undefined {
    if (!usage) {
      return undefined;
    }
    const contextWindowTokens = inferContextWindowTokens(
      model.modelKey,
      model.providerModel,
    );
    if (!contextWindowTokens || contextWindowTokens <= 0) {
      return usage;
    }
    return {
      ...usage,
      contextWindowTokens,
      contextUsedRatio: clampRatio(usage.promptTokens / contextWindowTokens),
    };
  }
}

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "kimi/kimi-k2.5": 256_000,
  "kimi-2.5": 256_000,
  "qwen-plus": 131_072,
  "qwen3.5-flash": 1_000_000,
  "qwen3.5-plus": 1_000_000,
  "qwen3.6-plus": 1_000_000,
  "deepseek-v3.2": 128_000,
  "siliconflow/deepseek-v3.2": 128_000,
  "glm-5": 128_000,
  "minimax-m2.7": 200_000,
  "minimax/minimax-m2.7": 200_000,
};

const MODEL_KEY_CONTEXT_WINDOWS: Record<string, number> = {
  "ainovel-free-creative": 1_000_000,
  "ainovel-free-reasoning": 1_000_000,
  "ainovel-plus-creative": 1_000_000,
  "ainovel-plus-reasoning": 1_000_000,
  "ainovel-super-creative": 1_000_000,
  "ainovel-super-reasoning": 1_000_000,
  "ainovel-lowcost-structured": 1_000_000,
};

function inferContextWindowTokens(
  modelKey: string,
  providerModel: string,
): number | undefined {
  const normalizedProviderModel = providerModel.trim().toLowerCase();
  return (
    MODEL_CONTEXT_WINDOWS[normalizedProviderModel] ??
    MODEL_KEY_CONTEXT_WINDOWS[modelKey.trim()]
  );
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

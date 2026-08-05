import type { LlmHealthService, LlmRouteRef } from "./llm-health.service.ts";
import { withContextUsage } from "./llm-context-window.ts";
import { DEFAULT_LLM_MODEL_REGISTRY } from "./llm-manager-registry.ts";
import { LlmRequestResolver } from "./llm-request-resolver.ts";
import type {
  LLMCompleteViaStreamOptions,
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMManagerOptions,
  LLMModelRegistry,
  LLMProvider,
  LLMProviderName,
  LLMStreamEvent,
  LLMToolCall,
  LLMUsage,
} from "./llm-manager-types.ts";
import {
  ApplicationError,
} from "../shared/errors.ts";

export { DEFAULT_LLM_MODEL_REGISTRY } from "./llm-manager-registry.ts";
export type {
  LLMCompleteViaStreamOptions,
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMManagerOptions,
  LLMMessage,
  LLMModelRegistry,
  LLMProvider,
  LLMProviderName,
  LLMRole,
  LLMStreamEvent,
  LLMToolCall,
  LLMToolDefinition,
  LLMUsage,
  ResolvedLLMCompletionRequest,
  ResolvedLLMModel,
} from "./llm-manager-types.ts";

export class LLMManager {
  private readonly requestResolver: LlmRequestResolver;

  constructor(
    private readonly providers: Record<LLMProviderName, LLMProvider>,
    private readonly modelRegistry: LLMModelRegistry = DEFAULT_LLM_MODEL_REGISTRY,
    private readonly options: LLMManagerOptions = {},
  ) {
    this.requestResolver = new LlmRequestResolver({
      providers,
      modelRegistry,
      managerOptions: options,
    });
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const resolution = await this.requestResolver.resolve(request);
    const startedAt = this.getNow();

    try {
      const result = await this.providers[
        resolution.request.model.provider
      ].complete(resolution.request);
      const usage = withContextUsage(
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
    const resolution = await this.requestResolver.resolve(request);
    const startedAt = this.getNow();
    let firstByteLatencyMs: number | undefined;
    let usage: LLMUsage | undefined;
    let finishReason: string | undefined;
    let text = "";
    let reasoningText = "";
    let sawDone = false;
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
          throw new ApplicationError(
            502,
            "LLM_PROVIDER_RESPONSE_INVALID",
            "LLM stream ended before a done event.",
            { reason: "missing_done_event" },
          );
        }

        const event = next.value;
        switch (event.type) {
          case "content_delta":
            firstByteLatencyMs ??= this.getNow().getTime() - startedAt.getTime();
            text += event.text;
            break;
          case "reasoning_delta":
            firstByteLatencyMs ??= this.getNow().getTime() - startedAt.getTime();
            reasoningText += event.text;
            break;
          case "tool_call_delta":
            firstByteLatencyMs ??= this.getNow().getTime() - startedAt.getTime();
            break;
          case "tool_call":
            firstByteLatencyMs ??= this.getNow().getTime() - startedAt.getTime();
            toolCalls.push(event.toolCall);
            break;
          case "usage":
            usage = withContextUsage(event.usage, resolution.request.model);
            break;
          case "done":
            finishReason = event.finishReason;
            sawDone = true;
            break;
          default:
            throw this.invalidStreamEventError(event);
        }

        if (sawDone) {
          break;
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
    const resolution = await this.requestResolver.resolve(request);
    const startedAt = this.getNow();
    let firstByteLatencyMs: number | undefined;
    let usage: LLMUsage | undefined;
    let sawDone = false;

    try {
      for await (const event of this.providers[
        resolution.request.model.provider
      ].stream(resolution.request)) {
        switch (event.type) {
          case "reasoning_delta":
          case "content_delta":
          case "tool_call_delta":
          case "tool_call":
            firstByteLatencyMs ??= this.getNow().getTime() - startedAt.getTime();
            yield event;
            break;
          case "usage":
            usage = withContextUsage(event.usage, resolution.request.model);
            yield {
              ...event,
              usage,
            };
            break;
          case "done": {
            const completedAt = this.getNow();
            await this.recordRouteResult(resolution.routeRefs, {
              ok: true,
              firstByteLatencyMs:
                firstByteLatencyMs ?? completedAt.getTime() - startedAt.getTime(),
              totalLatencyMs: completedAt.getTime() - startedAt.getTime(),
              usage,
              occurredAt: completedAt,
            });
            sawDone = true;
            yield event;
            break;
          }
          default:
            throw this.invalidStreamEventError(event);
        }
      }

      if (!sawDone) {
        throw new ApplicationError(
          502,
          "LLM_PROVIDER_RESPONSE_INVALID",
          "LLM stream ended before a done event.",
          { reason: "missing_done_event" },
        );
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

  private invalidStreamEventError(event: never): ApplicationError {
    const rawEvent = event as { type?: unknown };
    return new ApplicationError(
      502,
      "LLM_PROVIDER_RESPONSE_INVALID",
      "Unsupported LLM stream event type.",
      {
        reason: "unsupported_stream_event",
        eventType: String(rawEvent.type ?? "unknown"),
      },
    );
  }
}

import { withContextUsage } from "./llm-context-window.ts";
import { DEFAULT_LLM_MODEL_REGISTRY } from "./llm-manager-registry.ts";
import { LlmRequestResolver, type ResolvedLlmRequest } from "./llm-request-resolver.ts";
import { isLlmCallerCancelledError } from "./llm-caller-cancellation.ts";
import type {
  LLMCompleteViaStreamOptions,
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMManagerOptions,
  LLMModelRegistry,
  LLMProvider,
  LLMProviderName,
  LlmRoutingIdentity,
  LLMStreamEvent,
  LLMToolCall,
  LLMUsage,
} from "./llm-manager-types.ts";
import {
  ApplicationError,
} from "../shared/errors.ts";
import {
  createUsageEstimateAccumulator,
  estimateCompletionUsage,
  type LLMUsageEstimateAccumulator,
} from "./llm-usage-estimator.ts";

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
  LlmRoutingIdentity,
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
    const observation = this.startObservation(resolution, "non_stream", startedAt);

    try {
      const result = await this.providers[
        resolution.request.model.provider
      ].complete(resolution.request);
      const usage = withContextUsage(
        result.usage ?? estimateCompletionUsage(result, resolution.request),
        resolution.request.model,
      );
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

  async completeViaStream(
    request: LLMCompletionRequest,
    options: LLMCompleteViaStreamOptions = {},
  ): Promise<LLMCompletionResult> {
    const resolution = await this.requestResolver.resolve(request);
    const startedAt = this.getNow();
    const observation = this.startObservation(resolution, "stream", startedAt);
    let firstByteLatencyMs: number | undefined;
    let usage: LLMUsage | undefined;
    let finishReason: string | undefined;
    let text = "";
    let reasoningText = "";
    let sawDone = false;
    const toolCalls: LLMToolCall[] = [];
    const usageEstimate = createUsageEstimateAccumulator(resolution.request);
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
            if (firstByteLatencyMs === undefined) {
              const firstResponseAt = this.getNow();
              firstByteLatencyMs = firstResponseAt.getTime() - startedAt.getTime();
              observation?.markFirstResponse(firstResponseAt);
            }
            text += event.text;
            usageEstimate.addContentDelta(event.text);
            break;
          case "reasoning_delta":
            if (firstByteLatencyMs === undefined) {
              const firstResponseAt = this.getNow();
              firstByteLatencyMs = firstResponseAt.getTime() - startedAt.getTime();
              observation?.markFirstResponse(firstResponseAt);
            }
            reasoningText += event.text;
            usageEstimate.addReasoningDelta(event.text);
            break;
          case "tool_call_delta":
            if (firstByteLatencyMs === undefined) {
              const firstResponseAt = this.getNow();
              firstByteLatencyMs = firstResponseAt.getTime() - startedAt.getTime();
              observation?.markFirstResponse(firstResponseAt);
            }
            usageEstimate.addToolCallDelta(event.text);
            break;
          case "tool_call":
            if (firstByteLatencyMs === undefined) {
              const firstResponseAt = this.getNow();
              firstByteLatencyMs = firstResponseAt.getTime() - startedAt.getTime();
              observation?.markFirstResponse(firstResponseAt);
            }
            toolCalls.push(event.toolCall);
            usageEstimate.addFinalToolCall(event.toolCall);
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
      usage ??= withContextUsage(
        usageEstimate.toUsageFallback(),
        resolution.request.model,
      );
      await observation?.finalize({ usage, completedAt });
      await this.recordOwnedUsage(resolution.request.usageOwner, usage, completedAt);
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
      await observation?.finalize({ error, usage, completedAt });
      throw error;
    }
  }

  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
    if (request.signal?.aborted) return;
    const resolution = await this.requestResolver.resolve(request);
    if (request.signal?.aborted) return;
    const startedAt = this.getNow();
    const observation = this.startObservation(resolution, "stream", startedAt);
    let firstByteLatencyMs: number | undefined;
    let usage: LLMUsage | undefined;
    let sawDone = false;
    const usageEstimate = createUsageEstimateAccumulator(resolution.request);

    try {
      for await (const event of this.providers[
        resolution.request.model.provider
      ].stream(resolution.request)) {
        if (resolution.request.signal?.aborted) return;
        switch (event.type) {
          case "reasoning_delta":
          case "content_delta":
          case "tool_call_delta":
          case "tool_call":
            if (firstByteLatencyMs === undefined) {
              const firstResponseAt = this.getNow();
              firstByteLatencyMs = firstResponseAt.getTime() - startedAt.getTime();
              observation?.markFirstResponse(firstResponseAt);
            }
            this.addUsageEstimateEvent(usageEstimate, event);
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
            if (!usage) {
              usage = withContextUsage(
                usageEstimate.toUsageFallback(),
                resolution.request.model,
              );
              if (usage) {
                yield {
                  type: "usage",
                  usage,
                };
              }
            }
            await observation?.finalize({ usage, completedAt });
            await this.recordOwnedUsage(resolution.request.usageOwner, usage, completedAt);
            sawDone = true;
            yield event;
            break;
          }
          default:
            throw this.invalidStreamEventError(event);
        }
      }

      if (resolution.request.signal?.aborted) return;
      if (!sawDone) {
        throw new ApplicationError(
          502,
          "LLM_PROVIDER_RESPONSE_INVALID",
          "LLM stream ended before a done event.",
          { reason: "missing_done_event" },
        );
      }
    } catch (error) {
      if (
        resolution.request.signal?.aborted ||
        isLlmCallerCancelledError(error)
      ) {
        return;
      }
      const completedAt = this.getNow();
      await observation?.finalize({ error, usage, completedAt });
      throw error;
    } finally {
      if (observation && !observation.isFinalized) {
        await observation.finalize({ outcome: "cancelled", usage });
      }
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

  private startObservation(
    resolution: ResolvedLlmRequest,
    responseMode: "stream" | "non_stream",
    startedAt: Date,
  ) {
    const recorder = this.options.llmCallObservationRecorder ??
      this.options.llmMetricsService?.observationRecorder;
    const route = resolution.routeRef;
    return recorder?.start({
      appId: resolution.request.usageOwner?.appId,
      routingModelKey: route.modelKey,
      provider: route.provider,
      providerModel: route.providerModel,
      operation: "chat",
      responseMode,
      routingConfigRevision: resolution.routingConfigRevision,
      startedAt,
      now: this.options.now,
    });
  }

  private addUsageEstimateEvent(
    accumulator: LLMUsageEstimateAccumulator,
    event: LLMStreamEvent,
  ): void {
    switch (event.type) {
      case "content_delta":
        accumulator.addContentDelta(event.text);
        return;
      case "reasoning_delta":
        accumulator.addReasoningDelta(event.text);
        return;
      case "tool_call_delta":
        accumulator.addToolCallDelta(event.text);
        return;
      case "tool_call":
        accumulator.addFinalToolCall(event.toolCall);
        return;
      case "usage":
      case "done":
        return;
      default:
        throw this.invalidStreamEventError(event);
    }
  }

  private async recordOwnedUsage(
    owner: LLMCompletionRequest["usageOwner"],
    usage: LLMUsage | undefined,
    occurredAt: Date,
  ): Promise<void> {
    if (!owner || !usage) {
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
        // Usage accounting must never break an otherwise successful LLM response.
      }
    }
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

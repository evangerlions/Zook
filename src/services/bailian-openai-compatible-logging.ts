import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { describeUnknownError } from "../shared/error-diagnostics.ts";
import type { OpenAICompatibleResponsePayload } from "./bailian-openai-compatible-types.ts";
import { redactProviderRequestBody } from "./bailian-openai-compatible-utils.ts";

export class BailianOpenAICompatibleLocalLogger {
  constructor(private readonly logger?: StructuredLogger) {}

  beginStream(input: {
    modelKey: string;
    providerModel: string;
  }): BailianOpenAICompatibleStreamLogSession {
    return new BailianOpenAICompatibleStreamLogSession({
      logger: this.logger,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      enabled: shouldLogLocalProviderTraffic(),
      startedAtMs: Date.now(),
    });
  }

  chatRequest(input: {
    mode: "complete" | "stream";
    url: string;
    modelKey: string;
    providerModel: string;
    body: Record<string, unknown>;
    redactBody?: boolean;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    const bodySummary = summarizeChatRequestBody(input.body);
    this.logger.info("ai_novel local provider chat request started", {
      mode: input.mode,
      url: input.url,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      bodySummary,
      ...(shouldLogFullProviderBody()
        ? {
            body: input.redactBody
              ? redactProviderRequestBody(input.body)
              : input.body,
          }
        : {}),
    });
  }

  chatResponse(input: {
    mode: "complete";
    modelKey: string;
    providerModel: string;
    payload: OpenAICompatibleResponsePayload;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    const choice = input.payload.choices?.[0];
    this.logger.info("ai_novel local provider chat response completed", {
      mode: input.mode,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      id: input.payload.id,
      finishReason: choice?.finish_reason,
      contentPreview:
        typeof choice?.message?.content === "string"
          ? choice.message.content.slice(0, 500)
          : choice?.message?.content,
      toolCalls: choice?.message?.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function?.name,
        argumentsPreview: toolCall.function?.arguments?.slice(0, 500),
      })),
      usage: input.payload.usage,
    });
  }

  chatErrorResponse(input: {
    mode: "complete";
    modelKey: string;
    providerModel: string;
    statusCode: number;
    payload: OpenAICompatibleResponsePayload;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    this.logger.warn("ai_novel local provider chat error response body", {
      mode: input.mode,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      statusCode: input.statusCode,
      error: input.payload.error,
      message: input.payload.message,
      id: input.payload.id,
    });
  }
}

export class BailianOpenAICompatibleStreamLogSession {
  private streamChunkCount = 0;
  private reasoningChars = 0;
  private contentChars = 0;
  private toolDeltaChars = 0;
  private firstEventElapsedMs?: number;
  private firstReasoningElapsedMs?: number;
  private firstContentElapsedMs?: number;
  private firstToolDeltaElapsedMs?: number;
  private firstUsageElapsedMs?: number;
  private lastStreamEvent?: Record<string, unknown>;

  constructor(
    private readonly input: {
      logger?: StructuredLogger;
      modelKey: string;
      providerModel: string;
      enabled: boolean;
      startedAtMs: number;
    },
  ) {}

  rawStreamChunk(input: { chunk: string }): void {
    if (!this.input.logger || !this.input.enabled) {
      return;
    }
    this.streamChunkCount += 1;
    const elapsedMs = Date.now() - this.input.startedAtMs;
    this.firstEventElapsedMs ??= elapsedMs;
    const event = summarizeStreamChunk(input.chunk);
    this.lastStreamEvent = {
      modelKey: this.input.modelKey,
      providerModel: this.input.providerModel,
      chunkIndex: this.streamChunkCount,
      elapsedMs,
      ...event,
    };
    this.updateSummary(event, elapsedMs);

    if (isHighFrequencyDeltaEvent(event)) {
      this.input.logger.info("ai_novel local provider stream delta", {
        preview: event.preview,
      });
      return;
    }
    this.input.logger.info("ai_novel local provider stream event", {
      ...this.lastStreamEvent,
      ...this.doneSummary(event),
    });
  }

  streamFailure(input: { error: unknown }): void {
    if (!this.input.logger || !this.input.enabled) {
      return;
    }
    const elapsedMs = Date.now() - this.input.startedAtMs;
    this.input.logger.error("ai_novel local provider stream failed", {
      modelKey: this.input.modelKey,
      providerModel: this.input.providerModel,
      elapsedMs,
      chunkCount: this.streamChunkCount,
      firstEventElapsedMs: this.firstEventElapsedMs,
      firstReasoningElapsedMs: this.firstReasoningElapsedMs,
      firstContentElapsedMs: this.firstContentElapsedMs,
      firstToolDeltaElapsedMs: this.firstToolDeltaElapsedMs,
      firstUsageElapsedMs: this.firstUsageElapsedMs,
      reasoningChars: this.reasoningChars,
      contentChars: this.contentChars,
      toolDeltaChars: this.toolDeltaChars,
      lastStreamEvent: this.lastStreamEvent,
      ...describeUnknownError(input.error, "error"),
    });
  }

  private updateSummary(
    event: Record<string, unknown> & { kind: string; deltaLength: number },
    elapsedMs: number,
  ): void {
    if (event.kind === "reasoning_delta") {
      this.reasoningChars += event.deltaLength;
      this.firstReasoningElapsedMs ??= elapsedMs;
    } else if (event.kind === "content_delta") {
      this.contentChars += event.deltaLength;
      this.firstContentElapsedMs ??= elapsedMs;
    } else if (event.kind === "tool_call_delta") {
      this.toolDeltaChars += event.deltaLength;
      this.firstToolDeltaElapsedMs ??= elapsedMs;
    } else if (event.kind === "usage") {
      this.firstUsageElapsedMs ??= elapsedMs;
    }
  }

  private doneSummary(
    event: Record<string, unknown> & { kind: string },
  ): Record<string, unknown> {
    if (event.kind !== "done") {
      return {};
    }
    return {
      firstEventElapsedMs: this.firstEventElapsedMs,
      firstReasoningElapsedMs: this.firstReasoningElapsedMs,
      firstContentElapsedMs: this.firstContentElapsedMs,
      firstToolDeltaElapsedMs: this.firstToolDeltaElapsedMs,
      firstUsageElapsedMs: this.firstUsageElapsedMs,
      reasoningChars: this.reasoningChars,
      contentChars: this.contentChars,
      toolDeltaChars: this.toolDeltaChars,
    };
  }
}

function summarizeChatRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    model: body.model,
    stream: body.stream,
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    enableThinking: body.enable_thinking,
    toolChoice: body.tool_choice,
    toolCount: tools.length,
    messageCount: messages.length,
    messageChars: messages.reduce((total, item) => {
      if (!item || typeof item !== "object") {
        return total;
      }
      const content = (item as Record<string, unknown>).content;
      return total + (typeof content === "string" ? content.length : 0);
    }, 0),
    streamOptions: body.stream_options,
  };
}

function summarizeStreamChunk(chunk: string): Record<string, unknown> & {
  kind: string;
  deltaLength: number;
} {
  if (chunk === "[DONE]") {
    return { kind: "done", deltaLength: 0 };
  }
  try {
    const payload = JSON.parse(chunk) as OpenAICompatibleResponsePayload;
    const usage = payload.usage;
    if (usage) {
      return {
        kind: "usage",
        deltaLength: 0,
        usage,
      };
    }
    const choice = payload.choices?.[0];
    const reasoning = choice?.delta?.reasoning_content;
    if (typeof reasoning === "string" && reasoning.length > 0) {
      return {
        kind: "reasoning_delta",
        deltaLength: reasoning.length,
        preview: deltaPreview(reasoning, "reasoning"),
      };
    }
    const content = choice?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      return {
        kind: "content_delta",
        deltaLength: content.length,
        preview: deltaPreview(content, "content"),
      };
    }
    const toolCall = choice?.delta?.tool_calls?.[0];
    const toolName = toolCall?.function?.name;
    const args = toolCall?.function?.arguments;
    if (typeof args === "string" && args.length > 0) {
      return {
        kind: "tool_call_delta",
        deltaLength: args.length,
        toolCallIndex: toolCall?.index,
        toolCallId: toolCall?.id,
        toolCallName: toolName,
        preview: deltaPreview(args, "tool"),
      };
    }
    if (choice?.finish_reason) {
      return {
        kind: "finish",
        deltaLength: 0,
        finishReason: choice.finish_reason,
      };
    }
    return { kind: "empty", deltaLength: 0 };
  } catch (error) {
    return {
      kind: "invalid_json",
      deltaLength: chunk.length,
      preview: deltaPreview(chunk),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isHighFrequencyDeltaEvent(
  event: Record<string, unknown> & { kind: string },
): event is Record<string, unknown> & { kind: string; preview: string } {
  return (
    (event.kind === "reasoning_delta" ||
      event.kind === "content_delta" ||
      event.kind === "tool_call_delta") &&
    typeof event.preview === "string"
  );
}

function deltaPreview(value: string, origin = "raw"): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const preview = normalized.length <= 80
    ? normalized
    : `${normalized.slice(0, 80)}...`;
  return `[${origin} +]${preview}`;
}

function shouldLogFullProviderBody(): boolean {
  return process.env.ZOOK_LOG_FULL_PROVIDER_BODY === "1";
}

function shouldLogLocalProviderTraffic(): boolean {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  return (
    appEnv === "local" ||
    appEnv === "dev" ||
    appEnv === "development" ||
    nodeEnv === "development"
  );
}

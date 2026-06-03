import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type {
  EmbeddingProvider,
  EmbeddingResult,
  ResolvedEmbeddingRequest,
} from "./embedding-manager.ts";
import type {
  LLMCompletionResult,
  LLMProvider,
  LLMStreamEvent,
  LLMUsage,
  ResolvedLLMCompletionRequest,
} from "./llm-manager.ts";

const DEFAULT_BAILIAN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_BAILIAN_API_KEY = "mock-bailian-api-key";
const DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS = 20_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 20_000;
const ZOOK_LOG_BODY_MODE_OPTION = "zookLogBodyMode";

interface OpenAICompatibleChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }> | null;
  };
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }> | null;
  };
  finish_reason?: string | null;
}

interface OpenAICompatibleResponsePayload {
  id?: string;
  request_id?: string;
  choices?: OpenAICompatibleChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  message?: string;
}

interface OpenAICompatibleEmbeddingPayload {
  id?: string;
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  message?: string;
}

export interface BailianOpenAICompatibleProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImplementation?: typeof fetch;
  logger?: StructuredLogger;
}

export class BailianOpenAICompatibleProvider
  implements LLMProvider, EmbeddingProvider
{
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly logger?: StructuredLogger;

  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ??
        process.env.BAILIAN_BASE_URL ??
        DEFAULT_BAILIAN_BASE_URL,
    );
    this.apiKey =
      options.apiKey ?? process.env.BAILIAN_API_KEY ?? DEFAULT_BAILIAN_API_KEY;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    this.logger = options.logger;

    if (!this.fetchImplementation) {
      throw new Error("fetch is not available in the current runtime.");
    }
  }

  async complete(
    request: ResolvedLLMCompletionRequest,
  ): Promise<LLMCompletionResult> {
    const requestBody = this.buildChatRequestBody(request);
    this.logLocalProviderChatRequest({
      mode: "complete",
      url: this.buildChatUrl(
        request.model.providerConfig?.baseUrl ?? this.baseUrl,
      ),
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      body: requestBody,
      redactBody: this.shouldRedactProviderLog(request.providerOptions),
    });
    const response = await this.execute(
      this.buildChatUrl(request.model.providerConfig?.baseUrl ?? this.baseUrl),
      this.buildCompletionRequestInit(
        request.model.providerConfig?.apiKey ?? this.apiKey,
        request.model.providerConfig?.timeoutMs ?? 0,
        requestBody,
      ),
    );
    const payload = await this.readJsonPayload(response, !response.ok);

    if (!response.ok || payload.error) {
      this.logLocalProviderChatErrorResponse({
        mode: "complete",
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        statusCode: response.status,
        payload,
      });
      this.throwProviderRequestFailed(response.status, payload);
    }
    this.logLocalProviderChatResponse({
      mode: "complete",
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      payload,
    });

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      this.throwProviderResponseInvalid(
        "Completion response does not contain a message choice.",
      );
    }

    const text = this.readOptionalString(choice.message.content);
    const toolCalls = this.parseCompletionToolCalls(
      choice.message.tool_calls,
      request.model.modelKey,
    );
    if (text === undefined && toolCalls.length === 0) {
      this.throwProviderResponseInvalid(
        "Completion response message content or tool calls are missing.",
      );
    }

    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text: text ?? "",
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      reasoningText: this.readOptionalString(choice.message.reasoning_content),
      finishReason: this.readOptionalString(choice.finish_reason),
      usage: this.parseChatUsage(payload.usage),
      providerRequestId: this.readOptionalString(payload.id),
    };
  }

  async embed(request: ResolvedEmbeddingRequest): Promise<EmbeddingResult> {
    const response = await this.execute(
      this.buildEmbeddingsUrl(
        request.model.providerConfig?.baseUrl ?? this.baseUrl,
      ),
      this.buildCompletionRequestInit(
        request.model.providerConfig?.apiKey ?? this.apiKey,
        request.model.providerConfig?.timeoutMs ?? 0,
        {
          ...this.getForwardedProviderOptions(request.providerOptions),
          model: request.model.providerModel,
          input: request.input,
        },
      ),
    );
    const payload = await this.readEmbeddingPayload(response, !response.ok);

    if (!response.ok || payload.error) {
      this.throwEmbeddingRequestFailed(response.status, payload);
    }

    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      this.throwProviderResponseInvalid(
        "Embedding response does not contain any vectors.",
      );
    }

    const vectors = payload.data.map((item, index) => {
      if (
        typeof item.index !== "number" ||
        !Array.isArray(item.embedding) ||
        item.embedding.some(
          (value) => typeof value !== "number" || Number.isNaN(value),
        )
      ) {
        this.throwProviderResponseInvalid(
          "Embedding response contains an invalid vector item.",
          {
            index,
          },
        );
      }

      return {
        index: item.index,
        embedding: item.embedding,
      };
    });

    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      vectors,
      usage: this.parseEmbeddingUsage(payload.usage),
      providerRequestId: this.readOptionalString(payload.id),
    };
  }

  async *stream(
    request: ResolvedLLMCompletionRequest,
  ): AsyncIterable<LLMStreamEvent> {
    const requestBody = {
      ...this.buildChatRequestBody(request),
      stream: true,
      stream_options: {
        ...this.getProviderStreamOptions(request.providerOptions),
        include_usage: true,
      },
    };
    this.logLocalProviderChatRequest({
      mode: "stream",
      url: this.buildChatUrl(
        request.model.providerConfig?.baseUrl ?? this.baseUrl,
      ),
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      body: requestBody,
      redactBody: this.shouldRedactProviderLog(request.providerOptions),
    });
    const streamOptions = this.getProviderStreamOptions(
      request.providerOptions,
    );
    const streamTimeouts = resolveStreamTimeouts(streamOptions);
    const controller = new AbortController();
    const firstEventTimeout = setTimeout(() => {
      controller.abort(
        new DOMException(
          "Bailian stream did not return response headers before the first-event timeout.",
          "TimeoutError",
        ),
      );
    }, streamTimeouts.firstEventTimeoutMs);
    let response: Response;
    try {
      response = await this.execute(
        this.buildChatUrl(
          request.model.providerConfig?.baseUrl ?? this.baseUrl,
        ),
        this.buildRequestInit(
          request.model.providerConfig?.apiKey ?? this.apiKey,
          requestBody,
          controller.signal,
        ),
      );
    } finally {
      clearTimeout(firstEventTimeout);
    }

    if (!response.ok) {
      const payload = await this.readJsonPayload(response, true);
      this.throwProviderRequestFailed(response.status, payload);
    }

    if (!response.body) {
      this.throwProviderResponseInvalid("Streaming response body is missing.");
    }

    let finishReason: string | undefined;
    const pendingToolCalls = new Map<
      number,
      { id?: string; name?: string; args: string; progressText?: string }
    >();
    for await (const eventData of readServerSentEvents(
      response.body,
      streamTimeouts,
    )) {
      this.logLocalProviderRawStreamChunk({
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        chunk: eventData,
      });
      if (eventData === "[DONE]") {
        yield {
          type: "done",
          finishReason,
        };
        return;
      }

      let payload: OpenAICompatibleResponsePayload;
      try {
        payload = JSON.parse(eventData) as OpenAICompatibleResponsePayload;
      } catch (error) {
        this.throwProviderResponseInvalid(
          "Streaming chunk is not valid JSON.",
          {
            cause: error instanceof Error ? error.message : String(error),
            chunk: eventData,
          },
        );
      }

      if (payload.error) {
        this.throwProviderRequestFailed(response.status, payload);
      }

      const usage = this.parseChatUsage(payload.usage);
      if (usage) {
        yield {
          type: "usage",
          usage,
          rawEvent: eventData,
        };
      }

      const choice = payload.choices?.[0];
      if (!choice) {
        if (!usage) {
          this.throwProviderResponseInvalid(
            "Streaming chunk does not contain choices or usage.",
          );
        }
        continue;
      }

      const nextFinishReason = this.readOptionalString(choice.finish_reason);
      if (nextFinishReason) {
        finishReason = nextFinishReason;
      }

      for (const deltaToolCall of choice.delta?.tool_calls ?? []) {
        const index =
          typeof deltaToolCall.index === "number" ? deltaToolCall.index : 0;
        const existing = pendingToolCalls.get(index) ?? { args: "" };
        const argumentDelta = deltaToolCall.function?.arguments ?? "";
        const nextName =
          this.readOptionalNonBlankString(deltaToolCall.function?.name) ??
          existing.name;
        const nextId =
          this.readOptionalNonBlankString(deltaToolCall.id) ?? existing.id;
        const toolArgumentPath = toolArgumentPathForProgress(nextName);
        const nextArgs = existing.args + argumentDelta;
        const nextProgressText = toolArgumentPath
          ? extractTopLevelJsonStringField(nextArgs, toolArgumentPath)
          : undefined;
        const progressDelta = toolArgumentPath
          ? nextProgressText?.slice((existing.progressText ?? "").length)
          : argumentDelta;
        pendingToolCalls.set(index, {
          id: nextId,
          name: nextName,
          args: nextArgs,
          progressText: nextProgressText ?? existing.progressText,
        });
        if (progressDelta) {
          yield {
            type: "tool_call_delta",
            text: progressDelta,
            toolCallId: nextId,
            toolCallName: nextName,
            toolArgumentPath,
            rawEvent: eventData,
          };
        }
      }

      const reasoningDelta = this.readOptionalString(
        choice.delta?.reasoning_content,
      );
      if (reasoningDelta) {
        yield {
          type: "reasoning_delta",
          text: reasoningDelta,
          rawEvent: eventData,
        };
      }

      const contentDelta = this.readOptionalString(choice.delta?.content);
      if (contentDelta) {
        yield {
          type: "content_delta",
          text: contentDelta,
          rawEvent: eventData,
        };
      }

      if (nextFinishReason === "tool_calls" && pendingToolCalls.size > 0) {
        for (const [index, toolCall] of pendingToolCalls.entries()) {
          if (!toolCall.name) {
            continue;
          }
          let input: Record<string, unknown>;
          try {
            const parsed = JSON.parse(toolCall.args || "{}");
            input =
              parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : {};
          } catch {
            input = {};
          }
          yield {
            type: "tool_call",
            toolCall: {
              id:
                toolCall.id ??
                this.buildFallbackToolCallId(request.model.modelKey, index),
              name: toolCall.name,
              input,
            },
            rawEvent: eventData,
          };
        }
        pendingToolCalls.clear();
      }
    }

    this.throwProviderResponseInvalid(
      "Streaming response ended before [DONE].",
    );
  }

  private buildChatUrl(baseUrl: string): string {
    return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  }

  private buildEmbeddingsUrl(baseUrl: string): string {
    return `${normalizeBaseUrl(baseUrl)}/embeddings`;
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private buildRequestInit(
    apiKey: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): RequestInit {
    return {
      method: "POST",
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    };
  }

  private buildCompletionRequestInit(
    apiKey: string,
    timeoutMs: number,
    body: Record<string, unknown>,
  ): RequestInit {
    return this.buildRequestInit(
      apiKey,
      body,
      timeoutMs > 0 &&
        typeof AbortSignal !== "undefined" &&
        "timeout" in AbortSignal
        ? AbortSignal.timeout(timeoutMs)
        : undefined,
    );
  }

  private buildChatRequestBody(
    request: ResolvedLLMCompletionRequest,
  ): Record<string, unknown> {
    return {
      ...this.getForwardedProviderOptions(request.providerOptions),
      model: request.model.providerModel,
      messages: request.messages.map((message) => ({
        role: message.role,
        ...(message.content === undefined ? {} : { content: message.content }),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(Array.isArray(message.toolCalls) && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.input ?? {}),
                },
              })),
            }
          : {}),
      })),
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.maxTokens === undefined
        ? {}
        : { max_tokens: request.maxTokens }),
    };
  }

  private async execute(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImplementation(url, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw new ApplicationError(
          504,
          "LLM_PROVIDER_REQUEST_FAILED",
          "Bailian request timed out.",
          {
            provider: "bailian",
            reason: "timeout",
            cause: error instanceof Error ? error.message : String(error),
          },
        );
      }

      throw new ApplicationError(
        502,
        "LLM_PROVIDER_REQUEST_FAILED",
        "Bailian request failed before a response was received.",
        {
          provider: "bailian",
          reason: "network_error",
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async readJsonPayload(
    response: Response,
    allowInvalidJsonDetails: boolean,
  ): Promise<OpenAICompatibleResponsePayload> {
    const rawBody = await response.text();
    if (!rawBody) {
      this.throwProviderResponseInvalid("Provider response body is empty.");
    }

    try {
      return JSON.parse(rawBody) as OpenAICompatibleResponsePayload;
    } catch (error) {
      if (allowInvalidJsonDetails) {
        this.throwProviderRequestFailed(response.status, {
          message: `Provider returned non-JSON error payload: ${rawBody}`,
        });
      }

      this.throwProviderResponseInvalid(
        "Provider response is not valid JSON.",
        {
          cause: error instanceof Error ? error.message : String(error),
          body: rawBody,
        },
      );
    }
  }

  private async readEmbeddingPayload(
    response: Response,
    allowInvalidJsonDetails: boolean,
  ): Promise<OpenAICompatibleEmbeddingPayload> {
    const rawBody = await response.text();
    if (!rawBody) {
      this.throwProviderResponseInvalid("Provider response body is empty.");
    }

    try {
      return JSON.parse(rawBody) as OpenAICompatibleEmbeddingPayload;
    } catch (error) {
      if (allowInvalidJsonDetails) {
        this.throwProviderRequestFailed(response.status, {
          message: `Provider returned non-JSON error payload: ${rawBody}`,
        });
      }

      this.throwProviderResponseInvalid(
        "Provider response is not valid JSON.",
        {
          cause: error instanceof Error ? error.message : String(error),
          body: rawBody,
        },
      );
    }
  }

  private parseChatUsage(
    usage: OpenAICompatibleResponsePayload["usage"],
  ): LLMUsage | undefined {
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.prompt_tokens;
    const completionTokens = usage.completion_tokens;
    const totalTokens = usage.total_tokens;
    if (
      typeof promptTokens !== "number" ||
      typeof completionTokens !== "number" ||
      typeof totalTokens !== "number"
    ) {
      this.throwProviderResponseInvalid("Provider usage payload is invalid.");
    }

    return {
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  private parseEmbeddingUsage(
    usage: OpenAICompatibleEmbeddingPayload["usage"],
  ): LLMUsage | undefined {
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.prompt_tokens;
    const totalTokens = usage.total_tokens;
    if (typeof promptTokens !== "number" || typeof totalTokens !== "number") {
      this.throwProviderResponseInvalid(
        "Provider embedding usage payload is invalid.",
      );
    }

    return {
      promptTokens,
      completionTokens:
        typeof usage.completion_tokens === "number"
          ? usage.completion_tokens
          : 0,
      totalTokens,
    };
  }

  private getProviderStreamOptions(
    providerOptions: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!providerOptions) {
      return undefined;
    }

    const value = providerOptions.stream_options;
    return isRecord(value) ? value : undefined;
  }

  private getForwardedProviderOptions(
    providerOptions: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!providerOptions) {
      return {};
    }
    const forwarded = { ...providerOptions };
    delete forwarded[ZOOK_LOG_BODY_MODE_OPTION];
    return forwarded;
  }

  private shouldRedactProviderLog(
    providerOptions: Record<string, unknown> | undefined,
  ): boolean {
    return providerOptions?.[ZOOK_LOG_BODY_MODE_OPTION] === "redacted";
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private readOptionalNonBlankString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private parseCompletionToolCalls(
    toolCalls: NonNullable<OpenAICompatibleChoice["message"]>["tool_calls"],
    modelKey: string,
  ): NonNullable<LLMCompletionResult["toolCalls"]> {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    return toolCalls.map((toolCall, index) => {
      const name = this.readOptionalNonBlankString(toolCall.function?.name);
      if (!name) {
        this.throwProviderResponseInvalid(
          "Completion response tool call is missing a function name.",
        );
      }

      let input: Record<string, unknown>;
      try {
        const parsed = JSON.parse(toolCall.function?.arguments || "{}");
        if (!isRecord(parsed)) {
          this.throwProviderResponseInvalid(
            "Completion response tool call arguments must be a JSON object.",
          );
        }
        input = parsed;
      } catch (error) {
        if (error instanceof ApplicationError) {
          throw error;
        }
        this.throwProviderResponseInvalid(
          "Completion response tool call arguments are not valid JSON.",
          {
            cause: error instanceof Error ? error.message : String(error),
            toolName: name,
          },
        );
      }

      return {
        id:
          this.readOptionalNonBlankString(toolCall.id) ??
          this.buildFallbackToolCallId(modelKey, index),
        name,
        input,
      };
    });
  }

  private buildFallbackToolCallId(modelKey: string, index: number): string {
    return `${modelKey}_tool_${index}`;
  }

  private throwProviderRequestFailed(
    statusCode: number,
    payload: OpenAICompatibleResponsePayload,
  ): never {
    if (this.isDataInspectionFailure(payload)) {
      throw new ApplicationError(
        400,
        "LLM_PROVIDER_CONTENT_SENSITIVE",
        payload.error?.message ??
          payload.message ??
          "Bailian content inspection rejected the request.",
        {
          provider: "bailian",
          statusCode,
          errorCode: payload.error?.code,
          errorType: payload.error?.type,
          providerRequestId: payload.request_id ?? payload.id,
        },
      );
    }

    const errorMessage =
      payload.error?.message ??
      payload.message ??
      `Bailian request failed with status ${statusCode}.`;

    throw new ApplicationError(
      502,
      "LLM_PROVIDER_REQUEST_FAILED",
      errorMessage,
      {
        provider: "bailian",
        statusCode,
        errorCode: payload.error?.code,
        errorType: payload.error?.type,
        providerRequestId: payload.request_id ?? payload.id,
      },
    );
  }

  private isDataInspectionFailure(
    payload: OpenAICompatibleResponsePayload,
  ): boolean {
    const values = [
      payload.error?.code,
      payload.error?.type,
      payload.message,
      payload.error?.message,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase());

    return values.some(
      (value) =>
        value === "data_inspection_failed" ||
        value === "datainspectionfailed" ||
        value.includes("data inspection failed") ||
        value.includes("data_inspection_failed"),
    );
  }

  private throwEmbeddingRequestFailed(
    statusCode: number,
    payload: OpenAICompatibleEmbeddingPayload,
  ): never {
    const errorMessage =
      payload.error?.message ??
      payload.message ??
      `Bailian embedding request failed with status ${statusCode}.`;

    throw new ApplicationError(
      502,
      "LLM_PROVIDER_REQUEST_FAILED",
      errorMessage,
      {
        provider: "bailian",
        statusCode,
        errorCode: payload.error?.code,
        errorType: payload.error?.type,
        providerRequestId: payload.request_id ?? payload.id,
      },
    );
  }

  private throwProviderResponseInvalid(
    message: string,
    details?: unknown,
  ): never {
    throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", message, {
      provider: "bailian",
      ...toRecord(details),
    });
  }

  private shouldLogLocalProviderTraffic(): boolean {
    const appEnv = String(process.env.APP_ENV ?? "")
      .trim()
      .toLowerCase();
    const nodeEnv = String(process.env.NODE_ENV ?? "")
      .trim()
      .toLowerCase();
    return (
      appEnv === "local" ||
      appEnv === "dev" ||
      appEnv === "development" ||
      nodeEnv === "development"
    );
  }

  private logLocalProviderChatRequest(input: {
    mode: "complete" | "stream";
    url: string;
    modelKey: string;
    providerModel: string;
    body: Record<string, unknown>;
    redactBody?: boolean;
  }): void {
    if (!this.logger || !this.shouldLogLocalProviderTraffic()) {
      return;
    }
    this.logger.info("ai_novel local provider chat request body", {
      mode: input.mode,
      url: input.url,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      body: input.redactBody
        ? redactProviderRequestBody(input.body)
        : input.body,
    });
  }

  private logLocalProviderRawStreamChunk(input: {
    modelKey: string;
    providerModel: string;
    chunk: string;
  }): void {
    if (!this.logger || !this.shouldLogLocalProviderTraffic()) {
      return;
    }
    this.logger.info("ai_novel local provider raw stream chunk", {
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      chunk: input.chunk,
    });
  }

  private logLocalProviderChatResponse(input: {
    mode: "complete";
    modelKey: string;
    providerModel: string;
    payload: OpenAICompatibleResponsePayload;
  }): void {
    if (!this.logger || !this.shouldLogLocalProviderTraffic()) {
      return;
    }
    const choice = input.payload.choices?.[0];
    this.logger.info("ai_novel local provider chat response body", {
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

  private logLocalProviderChatErrorResponse(input: {
    mode: "complete";
    modelKey: string;
    providerModel: string;
    statusCode: number;
    payload: OpenAICompatibleResponsePayload;
  }): void {
    if (!this.logger || !this.shouldLogLocalProviderTraffic()) {
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

async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  options: StreamTimeoutOptions = {},
): AsyncIterable<string> {
  const firstEventTimeoutMs = options.firstEventTimeoutMs ?? 0;
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let eventDataLines: string[] = [];
  let hasEvent = false;

  try {
    while (true) {
      const timeoutMs = hasEvent ? idleTimeoutMs : firstEventTimeoutMs;
      const result = await readStreamChunkWithTimeout(
        reader,
        timeoutMs,
        hasEvent,
      );
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

        if (!line) {
          if (eventDataLines.length > 0) {
            hasEvent = true;
            yield eventDataLines.join("\n");
            eventDataLines = [];
          }
          continue;
        }

        if (line.startsWith("data:")) {
          eventDataLines.push(line.slice("data:".length).trimStart());
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  if (buffer) {
    const trailingLine = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    if (trailingLine.startsWith("data:")) {
      eventDataLines.push(trailingLine.slice("data:".length).trimStart());
    }
  }

  if (eventDataLines.length > 0) {
    yield eventDataLines.join("\n");
  }
}

interface StreamTimeoutOptions {
  firstEventTimeoutMs?: number;
  idleTimeoutMs?: number;
}

function toolArgumentPathForProgress(
  toolName: string | undefined,
): string | undefined {
  switch (toolName) {
    case "write_draft":
      return "content";
    case "submit_next_chapter_brief":
      return "brief";
    case "submit_chapter_summary":
      return "summary";
    case "submit_chapter_review":
      return "summary";
    case "submit_snapshot":
      return "snapshot";
    default:
      return undefined;
  }
}

function extractTopLevelJsonStringField(
  jsonFragment: string,
  fieldName: string,
): string | undefined {
  const keyIndex = jsonFragment.indexOf(JSON.stringify(fieldName));
  if (keyIndex < 0) {
    return undefined;
  }

  let index = keyIndex + JSON.stringify(fieldName).length;
  while (/\s/.test(jsonFragment[index] ?? "")) {
    index += 1;
  }
  if (jsonFragment[index] !== ":") {
    return undefined;
  }
  index += 1;
  while (/\s/.test(jsonFragment[index] ?? "")) {
    index += 1;
  }
  if (jsonFragment[index] !== '"') {
    return undefined;
  }

  let value = "";
  index += 1;
  while (index < jsonFragment.length) {
    const char = jsonFragment[index];
    if (char === '"') {
      return value;
    }
    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }

    if (index + 1 >= jsonFragment.length) {
      return value;
    }
    const escapeChar = jsonFragment[index + 1];
    if (escapeChar === "u") {
      const code = jsonFragment.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) {
        return value;
      }
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 6;
      continue;
    }

    value += decodeJsonEscape(escapeChar);
    index += 2;
  }

  return value;
}

function decodeJsonEscape(char: string): string {
  switch (char) {
    case '"':
    case "\\":
    case "/":
      return char;
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return "";
  }
}

function resolveStreamTimeouts(
  streamOptions: Record<string, unknown> | undefined,
): Required<StreamTimeoutOptions> {
  return {
    firstEventTimeoutMs: readPositiveInteger(
      streamOptions?.first_event_timeout_ms,
      DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS,
    ),
    idleTimeoutMs: readPositiveInteger(
      streamOptions?.idle_timeout_ms,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    ),
  };
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  hasEvent: boolean,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (timeoutMs <= 0) {
    return reader.read();
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new ApplicationError(
              504,
              "LLM_PROVIDER_REQUEST_FAILED",
              hasEvent
                ? "Bailian stream stalled before completion."
                : "Bailian stream did not produce an initial event in time.",
              {
                provider: "bailian",
                reason: hasEvent
                  ? "stream_idle_timeout"
                  : "stream_first_event_timeout",
                timeoutMs,
              },
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function toRecord(details: unknown): Record<string, unknown> {
  return isRecord(details) ? details : {};
}

function redactProviderRequestBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...body,
    ...(Array.isArray(body.messages)
      ? {
          messages: body.messages.map((message) =>
            redactProviderLogMessage(message),
          ),
        }
      : {}),
  };
}

function redactProviderLogMessage(message: unknown): unknown {
  if (!isRecord(message)) {
    return message;
  }
  const content = message.content;
  if (typeof content !== "string") {
    return message;
  }
  return {
    ...message,
    content: "[redacted]",
    contentLength: content.length,
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

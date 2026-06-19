import { ApplicationError } from "../shared/errors.ts";
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
import { parseBailianOpenAICompatibleStream } from "./bailian-openai-compatible-stream.ts";
import { BailianOpenAICompatibleLocalLogger } from "./bailian-openai-compatible-logging.ts";
import {
  DEFAULT_BAILIAN_API_KEY,
  DEFAULT_BAILIAN_BASE_URL,
  ZOOK_LOG_BODY_MODE_OPTION,
  type BailianOpenAICompatibleProviderOptions,
  type OpenAICompatibleChoice,
  type OpenAICompatibleEmbeddingPayload,
  type OpenAICompatibleResponsePayload,
} from "./bailian-openai-compatible-types.ts";
import {
  buildFallbackToolCallId,
  isAbortError,
  isRecord,
  normalizeBaseUrl,
  readOptionalNonBlankString,
  readOptionalString,
  resolveStreamTimeouts,
  throwEmbeddingRequestFailed,
  throwProviderRequestFailed,
  throwProviderResponseInvalid,
} from "./bailian-openai-compatible-utils.ts";

export type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";

export class BailianOpenAICompatibleProvider
  implements LLMProvider, EmbeddingProvider
{
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly localLogger: BailianOpenAICompatibleLocalLogger;

  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ??
        process.env.BAILIAN_BASE_URL ??
        DEFAULT_BAILIAN_BASE_URL,
    );
    this.apiKey =
      options.apiKey ?? process.env.BAILIAN_API_KEY ?? DEFAULT_BAILIAN_API_KEY;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    this.localLogger = new BailianOpenAICompatibleLocalLogger(options.logger);

    if (!this.fetchImplementation) {
      throw new Error("fetch is not available in the current runtime.");
    }
  }

  async complete(
    request: ResolvedLLMCompletionRequest,
  ): Promise<LLMCompletionResult> {
    const requestBody = this.buildChatRequestBody(request);
    this.localLogger.chatRequest({
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
      this.localLogger.chatErrorResponse({
        mode: "complete",
        modelKey: request.model.modelKey,
        providerModel: request.model.providerModel,
        statusCode: response.status,
        payload,
      });
      throwProviderRequestFailed(response.status, payload);
    }
    this.localLogger.chatResponse({
      mode: "complete",
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      payload,
    });

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      throwProviderResponseInvalid(
        "Completion response does not contain a message choice.",
      );
    }

    const text = readOptionalString(choice.message.content);
    const toolCalls = this.parseCompletionToolCalls(
      choice.message.tool_calls,
      request.model.modelKey,
    );
    if (text === undefined && toolCalls.length === 0) {
      throwProviderResponseInvalid(
        "Completion response message content or tool calls are missing.",
      );
    }

    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text: text ?? "",
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      reasoningText: readOptionalString(choice.message.reasoning_content),
      finishReason: readOptionalString(choice.finish_reason),
      usage: this.parseChatUsage(payload.usage),
      providerRequestId: readOptionalString(payload.id),
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
      throwEmbeddingRequestFailed(response.status, payload);
    }

    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      throwProviderResponseInvalid(
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
        throwProviderResponseInvalid(
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
      providerRequestId: readOptionalString(payload.id),
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
    this.localLogger.chatRequest({
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
      throwProviderRequestFailed(response.status, payload);
    }

    if (!response.body) {
      throwProviderResponseInvalid("Streaming response body is missing.");
    }

    const streamLog = this.localLogger.beginStream({
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
    });

    try {
      for await (const event of parseBailianOpenAICompatibleStream({
        body: response.body,
        responseStatus: response.status,
        modelKey: request.model.modelKey,
        parseChatUsage: (usage) => this.parseChatUsage(usage),
        logRawChunk: (chunk) => streamLog.rawStreamChunk({ chunk }),
        streamOptions,
      })) {
        yield event;
      }
    } catch (error) {
      streamLog.streamFailure({ error });
      throw error;
    }
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
        ...(message.role === "assistant" && message.reasoningContent
          ? { reasoning_content: message.reasoningContent }
          : {}),
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
      throwProviderResponseInvalid("Provider response body is empty.");
    }

    try {
      return JSON.parse(rawBody) as OpenAICompatibleResponsePayload;
    } catch (error) {
      if (allowInvalidJsonDetails) {
        throwProviderRequestFailed(response.status, {
          message: `Provider returned non-JSON error payload: ${rawBody}`,
        });
      }

      throwProviderResponseInvalid(
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
      throwProviderResponseInvalid("Provider response body is empty.");
    }

    try {
      return JSON.parse(rawBody) as OpenAICompatibleEmbeddingPayload;
    } catch (error) {
      if (allowInvalidJsonDetails) {
        throwProviderRequestFailed(response.status, {
          message: `Provider returned non-JSON error payload: ${rawBody}`,
        });
      }

      throwProviderResponseInvalid(
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
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
    if (
      typeof promptTokens !== "number" ||
      typeof completionTokens !== "number" ||
      typeof totalTokens !== "number" ||
      (reasoningTokens !== undefined && typeof reasoningTokens !== "number")
    ) {
      throwProviderResponseInvalid("Provider usage payload is invalid.");
    }

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
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
      throwProviderResponseInvalid(
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

  private parseCompletionToolCalls(
    toolCalls: NonNullable<OpenAICompatibleChoice["message"]>["tool_calls"],
    modelKey: string,
  ): NonNullable<LLMCompletionResult["toolCalls"]> {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    return toolCalls.map((toolCall, index) => {
      const name = readOptionalNonBlankString(toolCall.function?.name);
      if (!name) {
        throwProviderResponseInvalid(
          "Completion response tool call is missing a function name.",
        );
      }

      let input: Record<string, unknown>;
      try {
        const parsed = JSON.parse(toolCall.function?.arguments || "{}");
        if (!isRecord(parsed)) {
          throwProviderResponseInvalid(
            "Completion response tool call arguments must be a JSON object.",
          );
        }
        input = parsed;
      } catch (error) {
        if (error instanceof ApplicationError) {
          throw error;
        }
        throwProviderResponseInvalid(
          "Completion response tool call arguments are not valid JSON.",
          {
            cause: error instanceof Error ? error.message : String(error),
            toolName: name,
          },
        );
      }

      return {
        id:
          readOptionalNonBlankString(toolCall.id) ??
          buildFallbackToolCallId(modelKey, index),
        name,
        input,
      };
    });
  }

}

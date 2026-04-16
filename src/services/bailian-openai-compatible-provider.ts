import { ApplicationError } from "../shared/errors.ts";
import type { EmbeddingProvider, EmbeddingResult, ResolvedEmbeddingRequest } from "./embedding-manager.ts";
import type {
  LLMCompletionResult,
  LLMProvider,
  LLMStreamEvent,
  LLMUsage,
  ResolvedLLMCompletionRequest,
} from "./llm-manager.ts";

const DEFAULT_BAILIAN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_BAILIAN_API_KEY = "mock-bailian-api-key";

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
}

export class BailianOpenAICompatibleProvider implements LLMProvider, EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.BAILIAN_BASE_URL ?? DEFAULT_BAILIAN_BASE_URL);
    this.apiKey = options.apiKey ?? process.env.BAILIAN_API_KEY ?? DEFAULT_BAILIAN_API_KEY;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;

    if (!this.fetchImplementation) {
      throw new Error("fetch is not available in the current runtime.");
    }
  }

  async complete(request: ResolvedLLMCompletionRequest): Promise<LLMCompletionResult> {
    const response = await this.execute(
      this.buildChatUrl(request.model.providerConfig?.baseUrl ?? this.baseUrl),
      this.buildRequestInit(
        request.model.providerConfig?.apiKey ?? this.apiKey,
        request.model.providerConfig?.timeoutMs ?? 0,
        this.buildChatRequestBody(request),
      ),
    );
    const payload = await this.readJsonPayload(response, !response.ok);

    if (!response.ok || payload.error) {
      this.throwProviderRequestFailed(response.status, payload);
    }

    const choice = payload.choices?.[0];
    if (!choice?.message) {
      this.throwProviderResponseInvalid("Completion response does not contain a message choice.");
    }

    const text = this.readOptionalString(choice.message.content);
    if (text === undefined) {
      this.throwProviderResponseInvalid("Completion response message content is missing.");
    }

    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text,
      reasoningText: this.readOptionalString(choice.message.reasoning_content),
      finishReason: this.readOptionalString(choice.finish_reason),
      usage: this.parseChatUsage(payload.usage),
      providerRequestId: this.readOptionalString(payload.id),
    };
  }

  async embed(request: ResolvedEmbeddingRequest): Promise<EmbeddingResult> {
    const response = await this.execute(
      this.buildEmbeddingsUrl(request.model.providerConfig?.baseUrl ?? this.baseUrl),
      this.buildRequestInit(
        request.model.providerConfig?.apiKey ?? this.apiKey,
        request.model.providerConfig?.timeoutMs ?? 0,
        {
          ...request.providerOptions,
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
      this.throwProviderResponseInvalid("Embedding response does not contain any vectors.");
    }

    const vectors = payload.data.map((item, index) => {
      if (
        typeof item.index !== "number" ||
        !Array.isArray(item.embedding) ||
        item.embedding.some((value) => typeof value !== "number" || Number.isNaN(value))
      ) {
        this.throwProviderResponseInvalid("Embedding response contains an invalid vector item.", {
          index,
        });
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

  async *stream(request: ResolvedLLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
    const streamOptions = this.getProviderStreamOptions(request.providerOptions);
    const response = await this.execute(
      this.buildChatUrl(request.model.providerConfig?.baseUrl ?? this.baseUrl),
      this.buildRequestInit(
        request.model.providerConfig?.apiKey ?? this.apiKey,
        request.model.providerConfig?.timeoutMs ?? 0,
        {
          ...this.buildChatRequestBody(request),
          stream: true,
          stream_options: {
            ...streamOptions,
            include_usage: true,
          },
        },
      ),
    );

    if (!response.ok) {
      const payload = await this.readJsonPayload(response, true);
      this.throwProviderRequestFailed(response.status, payload);
    }

    if (!response.body) {
      this.throwProviderResponseInvalid("Streaming response body is missing.");
    }

    let finishReason: string | undefined;
    const pendingToolCalls = new Map<number, { id?: string; name?: string; args: string }>();
    for await (const eventData of readServerSentEvents(response.body)) {
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
        this.throwProviderResponseInvalid("Streaming chunk is not valid JSON.", {
          cause: error instanceof Error ? error.message : String(error),
          chunk: eventData,
        });
      }

      if (payload.error) {
        this.throwProviderRequestFailed(response.status, payload);
      }

      const usage = this.parseChatUsage(payload.usage);
      if (usage) {
        yield {
          type: "usage",
          usage,
        };
      }

      const choice = payload.choices?.[0];
      if (!choice) {
        if (!usage) {
          this.throwProviderResponseInvalid("Streaming chunk does not contain choices or usage.");
        }
        continue;
      }

      const nextFinishReason = this.readOptionalString(choice.finish_reason);
      if (nextFinishReason) {
        finishReason = nextFinishReason;
      }

      for (const deltaToolCall of choice.delta?.tool_calls ?? []) {
        const index = typeof deltaToolCall.index === "number" ? deltaToolCall.index : 0;
        const existing = pendingToolCalls.get(index) ?? { args: "" };
        pendingToolCalls.set(index, {
          id: deltaToolCall.id ?? existing.id,
          name: deltaToolCall.function?.name ?? existing.name,
          args: existing.args + (deltaToolCall.function?.arguments ?? ""),
        });
      }

      const reasoningDelta = this.readOptionalString(choice.delta?.reasoning_content);
      if (reasoningDelta) {
        yield {
          type: "reasoning_delta",
          text: reasoningDelta,
        };
      }

      const contentDelta = this.readOptionalString(choice.delta?.content);
      if (contentDelta) {
        yield {
          type: "content_delta",
          text: contentDelta,
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
              id: toolCall.id ?? `${request.model.modelKey}_tool_${index}`,
              name: toolCall.name,
              input,
            },
          };
        }
        pendingToolCalls.clear();
      }
    }

    this.throwProviderResponseInvalid("Streaming response ended before [DONE].");
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

  private buildRequestInit(apiKey: string, timeoutMs: number, body: Record<string, unknown>): RequestInit {
    return {
      method: "POST",
      headers: this.buildHeaders(apiKey),
      body: JSON.stringify(body),
      ...(timeoutMs > 0 && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? { signal: AbortSignal.timeout(timeoutMs) }
        : {}),
    };
  }

  private buildChatRequestBody(request: ResolvedLLMCompletionRequest): Record<string, unknown> {
    return {
      ...request.providerOptions,
      model: request.model.providerModel,
      messages: request.messages.map((message) => ({
        role: message.role,
        ...(message.content === undefined ? {} : { content: message.content }),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(Array.isArray(message.toolCalls) && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.input ?? {}),
                },
              })),
            }
          : {}),
      })),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    };
  }

  private async execute(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImplementation(url, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw new ApplicationError(504, "LLM_PROVIDER_REQUEST_FAILED", "Bailian request timed out.", {
          provider: "bailian",
          reason: "timeout",
          cause: error instanceof Error ? error.message : String(error),
        });
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

  private async readJsonPayload(response: Response, allowInvalidJsonDetails: boolean): Promise<OpenAICompatibleResponsePayload> {
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

      this.throwProviderResponseInvalid("Provider response is not valid JSON.", {
        cause: error instanceof Error ? error.message : String(error),
        body: rawBody,
      });
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

      this.throwProviderResponseInvalid("Provider response is not valid JSON.", {
        cause: error instanceof Error ? error.message : String(error),
        body: rawBody,
      });
    }
  }

  private parseChatUsage(usage: OpenAICompatibleResponsePayload["usage"]): LLMUsage | undefined {
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

  private parseEmbeddingUsage(usage: OpenAICompatibleEmbeddingPayload["usage"]): LLMUsage | undefined {
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.prompt_tokens;
    const totalTokens = usage.total_tokens;
    if (typeof promptTokens !== "number" || typeof totalTokens !== "number") {
      this.throwProviderResponseInvalid("Provider embedding usage payload is invalid.");
    }

    return {
      promptTokens,
      completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
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

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private throwProviderRequestFailed(statusCode: number, payload: OpenAICompatibleResponsePayload): never {
    const errorMessage =
      payload.error?.message ??
      payload.message ??
      `Bailian request failed with status ${statusCode}.`;

    throw new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", errorMessage, {
      provider: "bailian",
      statusCode,
      errorCode: payload.error?.code,
      errorType: payload.error?.type,
    });
  }

  private throwEmbeddingRequestFailed(statusCode: number, payload: OpenAICompatibleEmbeddingPayload): never {
    const errorMessage =
      payload.error?.message ??
      payload.message ??
      `Bailian embedding request failed with status ${statusCode}.`;

    throw new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", errorMessage, {
      provider: "bailian",
      statusCode,
      errorCode: payload.error?.code,
      errorType: payload.error?.type,
    });
  }

  private throwProviderResponseInvalid(message: string, details?: unknown): never {
    throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", message, {
      provider: "bailian",
      ...toRecord(details),
    });
  }
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  let eventDataLines: string[] = [];

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function toRecord(details: unknown): Record<string, unknown> {
  return isRecord(details) ? details : {};
}

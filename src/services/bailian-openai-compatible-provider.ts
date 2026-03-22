import { ApplicationError } from "../shared/errors.ts";
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
  };
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
  };
  finish_reason?: string | null;
}

interface OpenAICompatibleResponsePayload {
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

export interface BailianOpenAICompatibleProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImplementation?: typeof fetch;
}

export class BailianOpenAICompatibleProvider implements LLMProvider {
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
    const response = await this.fetchImplementation(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(request)),
    });
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
      provider: "bailian",
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text,
      reasoningText: this.readOptionalString(choice.message.reasoning_content),
      finishReason: this.readOptionalString(choice.finish_reason),
      usage: this.parseUsage(payload.usage),
    };
  }

  async *stream(request: ResolvedLLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
    const streamOptions = this.getProviderStreamOptions(request.providerOptions);
    const response = await this.fetchImplementation(this.buildUrl(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        ...request.providerOptions,
        model: request.model.providerModel,
        messages: request.messages,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        stream: true,
        stream_options: {
          ...streamOptions,
          include_usage: true,
        },
      }),
    });

    if (!response.ok) {
      const payload = await this.readJsonPayload(response, true);
      this.throwProviderRequestFailed(response.status, payload);
    }

    if (!response.body) {
      this.throwProviderResponseInvalid("Streaming response body is missing.");
    }

    let finishReason: string | undefined;
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

      const usage = this.parseUsage(payload.usage);
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
    }

    this.throwProviderResponseInvalid("Streaming response ended before [DONE].");
  }

  private buildUrl(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private buildRequestBody(request: ResolvedLLMCompletionRequest): Record<string, unknown> {
    return {
      ...request.providerOptions,
      model: request.model.providerModel,
      messages: request.messages,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    };
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

  private parseUsage(usage: OpenAICompatibleResponsePayload["usage"]): LLMUsage | undefined {
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

function toRecord(details: unknown): Record<string, unknown> {
  return isRecord(details) ? details : {};
}

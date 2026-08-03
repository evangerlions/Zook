import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";

export const DEFAULT_BAILIAN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_BAILIAN_API_KEY = "mock-bailian-api-key";
export const DEFAULT_STREAM_FIRST_EVENT_TIMEOUT_MS = 30_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 20_000;
export const ZOOK_LOG_BODY_MODE_OPTION = "zookLogBodyMode";

export interface OpenAICompatibleChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
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
    reasoning?: string | null;
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

export interface OpenAICompatibleResponsePayload {
  id?: string;
  request_id?: string;
  choices?: OpenAICompatibleChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    } | null;
  } | null;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  message?: string;
}

export interface OpenAICompatibleEmbeddingPayload {
  id?: string;
  request_id?: string;
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
  providerName?: string;
  fetchImplementation?: typeof fetch;
  logger?: StructuredLogger;
}

export interface StreamTimeoutOptions {
  firstEventTimeoutMs?: number;
  idleTimeoutMs?: number;
}

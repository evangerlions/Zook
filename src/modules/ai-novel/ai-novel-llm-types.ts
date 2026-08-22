import type { EmbeddingVector } from "../../services/embedding-manager.ts";
import type { LLMMessage, LLMToolCall } from "../../services/llm-manager.ts";
import type { AiNovelPromptProfile } from "./prompts/ai-novel-prompt-types.ts";

export interface AiNovelLocalDebugLlmRequestPayload {
  sceneKey: string;
  sceneRouteKey: string;
  temperature: number;
  maxTokens: number;
  profile?: AiNovelPromptProfile;
  requestBody: {
    sceneRouteKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    stream: boolean;
    providerOptions?: Record<string, unknown>;
  };
}

export interface AiNovelChatResponse {
  sceneKey: string;
  completion: {
    sceneRouteKey: string;
    provider: string;
    providerModel: string;
    content: string;
    toolCalls?: LLMToolCall[];
    reasoningText?: string;
    finishReason?: string;
    providerRequestId?: string;
  };
  localDebugLlmRequest?: AiNovelLocalDebugLlmRequestPayload;
}

export interface AiNovelUsagePayload {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  contextWindowTokens?: number;
  contextUsedRatio?: number;
  estimated?: boolean;
}

export type AiNovelChatStreamChunk =
  | {
      type: "local_debug_llm_request";
      payload: AiNovelLocalDebugLlmRequestPayload;
    }
  | {
      type: "tool_call";
      toolCall: {
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
    }
  | {
      type: "tool_call_delta";
      text: string;
      toolCallId?: string;
      toolCallName?: string;
      toolArgumentPath?: string;
    }
  | {
      type: "error";
      payload: {
        code: string;
        message: string;
        recoverable: boolean;
        details?: Record<string, unknown>;
      };
    }
  | { type: "reasoning_delta"; text: string }
  | { type: "content_delta"; text: string }
  | { type: "usage"; usage: AiNovelUsagePayload }
  | {
      type: "done";
      completion: {
        sceneRouteKey: string;
        content: string;
        reasoningText?: string;
        finishReason?: string;
      };
      usage?: AiNovelUsagePayload;
    };

export interface AiNovelEmbeddingsResponse {
  sceneKey: string;
  sceneRouteKey: string;
  provider: string;
  providerModel: string;
  vectors: EmbeddingVector[];
  providerRequestId?: string;
}

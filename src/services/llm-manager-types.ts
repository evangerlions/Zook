import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmHealthService } from "./llm-health.service.ts";
import type { LlmMetricsService } from "./llm-metrics.service.ts";

export type LLMProviderName = string;
export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface LLMMessage {
  role: LLMRole;
  content?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
  reasoningContent?: string;
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
  reasoningTokens?: number;
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

export interface LLMManagerOptions {
  commonLlmConfigService?: CommonLlmConfigService;
  llmHealthService?: LlmHealthService;
  llmMetricsService?: LlmMetricsService;
  random?: () => number;
  now?: () => Date;
}

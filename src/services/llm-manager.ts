import { badRequest, internalError } from "../shared/errors.ts";

export type LLMProviderName = "bailian";
export type LLMRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMCompletionRequest {
  modelKey: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  providerOptions?: Record<string, unknown>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMCompletionResult {
  provider: LLMProviderName;
  modelKey: string;
  providerModel: string;
  text: string;
  reasoningText?: string;
  finishReason?: string;
  usage?: LLMUsage;
}

export type LLMStreamEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "content_delta"; text: string }
  | { type: "usage"; usage: LLMUsage }
  | { type: "done"; finishReason?: string };

export interface ResolvedLLMModel {
  provider: LLMProviderName;
  modelKey: string;
  providerModel: string;
}

export interface ResolvedLLMCompletionRequest extends Omit<LLMCompletionRequest, "modelKey"> {
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

export const DEFAULT_LLM_MODEL_REGISTRY: LLMModelRegistry = {
  "kimi2.5": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
};

const VALID_ROLES = new Set<LLMRole>(["system", "user", "assistant"]);

export class LLMManager {
  constructor(
    private readonly providers: Record<LLMProviderName, LLMProvider>,
    private readonly modelRegistry: LLMModelRegistry = DEFAULT_LLM_MODEL_REGISTRY,
  ) {}

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const resolved = this.resolveRequest(request);
    return this.providers[resolved.model.provider].complete(resolved);
  }

  async *stream(request: LLMCompletionRequest): AsyncIterable<LLMStreamEvent> {
    const resolved = this.resolveRequest(request);
    yield* this.providers[resolved.model.provider].stream(resolved);
  }

  private resolveRequest(request: LLMCompletionRequest): ResolvedLLMCompletionRequest {
    const modelKey = request.modelKey.trim();
    if (!modelKey || !this.modelRegistry[modelKey]) {
      badRequest("LLM_MODEL_NOT_FOUND", `Unknown LLM modelKey: ${request.modelKey}.`);
    }

    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      badRequest("REQ_INVALID_BODY", "messages must contain at least one item.");
    }

    const messages = request.messages.map((message) => {
      if (!VALID_ROLES.has(message.role)) {
        badRequest("REQ_INVALID_BODY", `Unsupported LLM role: ${String(message.role)}.`);
      }

      if (typeof message.content !== "string" || !message.content.trim()) {
        badRequest("REQ_INVALID_BODY", "LLM message content must be a non-empty string.");
      }

      return {
        role: message.role,
        content: message.content,
      };
    });

    const resolvedModel = this.modelRegistry[modelKey];
    const provider = this.providers[resolvedModel.provider];
    if (!provider) {
      internalError(`LLM provider ${resolvedModel.provider} is not configured.`);
    }

    return {
      ...request,
      messages,
      model: {
        provider: resolvedModel.provider,
        modelKey,
        providerModel: resolvedModel.providerModel,
      },
    };
  }
}

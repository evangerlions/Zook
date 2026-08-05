import type { LLMUsage } from "./llm-manager.ts";
import type {
  OpenAICompatibleEmbeddingPayload,
  OpenAICompatibleResponsePayload,
} from "./bailian-openai-compatible-types.ts";
import { throwProviderResponseInvalid } from "./bailian-openai-compatible-utils.ts";

export function parseOpenAICompatibleChatUsage(
  usage: OpenAICompatibleResponsePayload["usage"],
  providerName: string,
): LLMUsage | undefined {
  if (!usage) return undefined;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  if (
    typeof usage.prompt_tokens !== "number" ||
    typeof usage.completion_tokens !== "number" ||
    typeof usage.total_tokens !== "number" ||
    (reasoningTokens !== undefined && typeof reasoningTokens !== "number")
  ) {
    throwProviderResponseInvalid("Provider usage payload is invalid.", undefined, providerName);
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
}

export function parseOpenAICompatibleEmbeddingUsage(
  usage: OpenAICompatibleEmbeddingPayload["usage"],
  providerName: string,
): LLMUsage | undefined {
  if (!usage) return undefined;
  if (typeof usage.prompt_tokens !== "number" || typeof usage.total_tokens !== "number") {
    throwProviderResponseInvalid("Provider embedding usage payload is invalid.", undefined, providerName);
  }
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    totalTokens: usage.total_tokens,
  };
}

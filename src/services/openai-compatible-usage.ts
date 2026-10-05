import type { LLMUsage } from "./llm-manager.ts";
import type {
  OpenAICompatibleEmbeddingPayload,
  OpenAICompatibleResponsePayload,
} from "./bailian-openai-compatible-types.ts";
import { normalizeLlmUsage } from "./llm-usage-normalizer.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";

export function parseOpenAICompatibleChatUsage(
  usage: OpenAICompatibleResponsePayload["usage"],
  providerName: string,
  logger?: StructuredLogger,
): LLMUsage | undefined {
  if (!usage) return undefined;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens;
  if (
    typeof usage.prompt_tokens !== "number" ||
    typeof usage.completion_tokens !== "number" ||
    typeof usage.total_tokens !== "number" ||
    (reasoningTokens !== undefined && typeof reasoningTokens !== "number")
  ) {
    return invalidUsage(providerName, "chat", logger);
  }
  return normalizeLlmUsage({
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
  }) ?? invalidUsage(providerName, "chat", logger);
}

export function parseOpenAICompatibleEmbeddingUsage(
  usage: OpenAICompatibleEmbeddingPayload["usage"],
  providerName: string,
  logger?: StructuredLogger,
): LLMUsage | undefined {
  if (!usage) return undefined;
  if (typeof usage.prompt_tokens !== "number" || typeof usage.total_tokens !== "number") {
    return invalidUsage(providerName, "embedding", logger);
  }
  return normalizeLlmUsage({
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens,
  }) ?? invalidUsage(providerName, "embedding", logger);
}

function invalidUsage(provider: string, operation: string, logger?: StructuredLogger): undefined {
  try {
    logger?.warn("invalid provider usage; using server fallback", {
      provider, operation, reason: "invalid_usage_counters", usageSource: "estimated_or_missing",
    });
  } catch {
    // Diagnostic failures must not discard an otherwise valid generation.
  }
  return undefined;
}

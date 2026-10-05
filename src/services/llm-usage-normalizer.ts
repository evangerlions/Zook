import type { LLMUsage } from "./llm-manager-types.ts";

/** Validate provider counters before either statistics or pricing consumes them. */
export function normalizeLlmUsage(usage: LLMUsage | undefined): LLMUsage | undefined {
  if (!usage) return undefined;
  const { promptTokens, completionTokens, totalTokens, reasoningTokens, cachedInputTokens } = usage;
  if (!isTokenCount(promptTokens) || !isTokenCount(completionTokens) || !isTokenCount(totalTokens)) {
    return undefined;
  }
  if (!Number.isSafeInteger(promptTokens + completionTokens) || totalTokens !== promptTokens + completionTokens) {
    return undefined;
  }
  if (reasoningTokens !== undefined && (!isTokenCount(reasoningTokens) || reasoningTokens > completionTokens)) {
    return undefined;
  }
  if (cachedInputTokens !== undefined && (!isTokenCount(cachedInputTokens) || cachedInputTokens > promptTokens)) {
    return undefined;
  }
  return { ...usage };
}

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

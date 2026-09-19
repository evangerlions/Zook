import type { LLMUsage } from "./llm-manager-types.ts";

/// The fixed context budget used by all Zook LLM routes.
///
/// Model/provider marketing limits vary by route and can change independently.
/// Agent clients receive this stable operating budget rather than inferring a
/// context limit from model names.
export const ZOOK_DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000;

export function withContextUsage(
  usage: LLMUsage | undefined,
  contextWindowTokens: number = ZOOK_DEFAULT_CONTEXT_WINDOW_TOKENS,
): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    ...usage,
    contextWindowTokens,
    contextUsedRatio: clampRatio(
      usage.promptTokens / contextWindowTokens,
    ),
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

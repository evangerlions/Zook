import type { LLMUsage } from "./llm-manager-types.ts";

/// The fixed context budget used by all Zook LLM routes.
///
/// Model/provider marketing limits vary by route and can change independently.
/// Agent clients receive this stable operating budget rather than inferring a
/// context limit from model names.
export const ZOOK_CONTEXT_WINDOW_TOKENS = 256_000;

export function withContextUsage(
  usage: LLMUsage | undefined,
): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    ...usage,
    contextWindowTokens: ZOOK_CONTEXT_WINDOW_TOKENS,
    contextUsedRatio: clampRatio(
      usage.promptTokens / ZOOK_CONTEXT_WINDOW_TOKENS,
    ),
  };
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

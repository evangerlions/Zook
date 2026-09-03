import type { LLMUsage, ResolvedLLMModel } from "./llm-manager-types.ts";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "kimi/kimi-k2.5": 256_000,
  "kimi-2.5": 256_000,
  "qwen-plus": 131_072,
  "qwen3.5-flash": 1_000_000,
  "qwen3.5-plus": 1_000_000,
  "qwen3.6-plus": 1_000_000,
  "qwen3.6-flash": 1_000_000,
  "qwen3.7-max": 1_000_000,
  "qwen3.7-plus": 1_000_000,
  "qwen3.8-flash": 1_000_000,
  "qwen3.8-max": 1_000_000,
  "deepseek-v4-flash-0731": 1_000_000,
  "deepseek-v4-pro": 1_000_000,
  "deepseek-v4-pro-0813": 1_000_000,
  "glm-5.2": 1_000_000,
  "deepseek-v3.2": 128_000,
  "siliconflow/deepseek-v3.2": 128_000,
  "glm-5": 128_000,
  "minimax-m2.7": 200_000,
  "minimax/minimax-m2.7": 200_000,
};

export function withContextUsage(
  usage: LLMUsage | undefined,
  model: ResolvedLLMModel,
): LLMUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const contextWindowTokens = inferContextWindowTokens(
    model.modelKey,
    model.providerModel,
  );
  if (!contextWindowTokens || contextWindowTokens <= 0) {
    return usage;
  }
  return {
    ...usage,
    contextWindowTokens,
    contextUsedRatio: clampRatio(usage.promptTokens / contextWindowTokens),
  };
}

function inferContextWindowTokens(
  modelKey: string,
  providerModel: string,
): number | undefined {
  const normalizedProviderModel = providerModel.trim().toLowerCase();
  return MODEL_CONTEXT_WINDOWS[normalizedProviderModel] ??
    MODEL_CONTEXT_WINDOWS[modelKey.trim().toLowerCase()];
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

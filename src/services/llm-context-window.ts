import type { LLMUsage, ResolvedLLMModel } from "./llm-manager-types.ts";

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "kimi/kimi-k2.5": 256_000,
  "kimi-2.5": 256_000,
  "qwen-plus": 131_072,
  "qwen3.5-flash": 1_000_000,
  "qwen3.5-plus": 1_000_000,
  "qwen3.6-plus": 1_000_000,
  "deepseek-v3.2": 128_000,
  "siliconflow/deepseek-v3.2": 128_000,
  "glm-5": 128_000,
  "minimax-m2.7": 200_000,
  "minimax/minimax-m2.7": 200_000,
};

const MODEL_KEY_CONTEXT_WINDOWS: Record<string, number> = {
  "ainovel-free-creative": 1_000_000,
  "ainovel-free-reasoning": 1_000_000,
  "ainovel-plus-creative": 1_000_000,
  "ainovel-plus-reasoning": 1_000_000,
  "ainovel-super-creative": 1_000_000,
  "ainovel-super-reasoning": 1_000_000,
  "ainovel-lowcost-structured": 1_000_000,
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
  return (
    MODEL_CONTEXT_WINDOWS[normalizedProviderModel] ??
    MODEL_KEY_CONTEXT_WINDOWS[modelKey.trim()]
  );
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

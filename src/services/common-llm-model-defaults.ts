import type { LlmModelConfig, LlmModelKind } from "../shared/types.ts";

export const DEFAULT_COMMON_LLM_MODEL_KEY = "qwen3.6-plus";

const QWEN_FLASH_MODEL_KEY = "qwen3.5-flash";
const TEXT_EMBEDDING_MODEL_KEY = "text-embedding-v4";
const OPENROUTER_FREE_MODEL_KEY = "openrouter-free";

export function createDefaultLlmModels(): LlmModelConfig[] {
  return [
    createDefaultModel(DEFAULT_COMMON_LLM_MODEL_KEY, "Qwen 3.6 Plus 通用模型", "chat", DEFAULT_COMMON_LLM_MODEL_KEY),
    createDefaultModel(TEXT_EMBEDDING_MODEL_KEY, "Text Embedding v4 通用向量模型", "embedding", TEXT_EMBEDDING_MODEL_KEY),
    createDefaultModel(QWEN_FLASH_MODEL_KEY, "Qwen 3.5 Flash 通用低成本审核", "chat", QWEN_FLASH_MODEL_KEY),
    {
      key: OPENROUTER_FREE_MODEL_KEY,
      label: "OpenRouter Free 测试模型",
      kind: "chat",
      strategy: "fixed",
      routes: [{ provider: "openrouter", providerModel: "openrouter/free", enabled: true, weight: 100 }],
    },
  ];
}

function createDefaultModel(
  key: string,
  label: string,
  kind: LlmModelKind,
  providerModel: string,
): LlmModelConfig {
  return {
    key,
    label,
    kind,
    strategy: "fixed",
    routes: [{ provider: "bailian", providerModel, enabled: true, weight: 100 }],
  };
}

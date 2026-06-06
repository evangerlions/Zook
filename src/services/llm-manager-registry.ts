import type { LLMModelRegistry } from "./llm-manager-types.ts";

export const DEFAULT_LLM_MODEL_REGISTRY: LLMModelRegistry = {
  "kimi2.5": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
  "novel-creative": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
  "novel-reasoning": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
  "novel-structured": {
    provider: "bailian",
    providerModel: "kimi/kimi-k2.5",
  },
};

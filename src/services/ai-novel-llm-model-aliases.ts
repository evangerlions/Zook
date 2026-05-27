import type { LlmModelKind } from "../shared/types.ts";

interface AiNovelModelAlias {
  kind: LlmModelKind;
  provider: string;
  providerModel: string;
}

const AI_NOVEL_MODEL_ALIASES: Record<string, AiNovelModelAlias> = {
  "ainovel-free-creative": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-free-reasoning": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-plus-creative": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-plus-reasoning": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-super-creative": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-super-reasoning": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-lowcost-structured": {
    kind: "chat",
    provider: "bailian",
    providerModel: "qwen3.6-plus",
  },
  "ainovel-embedding-default": {
    kind: "embedding",
    provider: "bailian",
    providerModel: "text-embedding-v4",
  },
};

export function resolveAiNovelModelAlias(modelKey: string): AiNovelModelAlias | undefined {
  return AI_NOVEL_MODEL_ALIASES[modelKey.trim()];
}

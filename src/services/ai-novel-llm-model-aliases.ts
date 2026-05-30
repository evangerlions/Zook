import type { LlmModelConfig, LlmModelKind } from "../shared/types.ts";

interface AiNovelSceneRouteAlias {
  kind: LlmModelKind;
  provider: string;
  providerModel: string;
}

const AI_NOVEL_SCENE_ROUTE_ALIASES: Record<string, AiNovelSceneRouteAlias> = {
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

export function resolveAiNovelSceneRouteAlias(
  sceneRouteKey: string,
): AiNovelSceneRouteAlias | undefined {
  return AI_NOVEL_SCENE_ROUTE_ALIASES[sceneRouteKey.trim()];
}

export function isAiNovelSceneRouteKey(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("ainovel-") || Boolean(resolveAiNovelSceneRouteAlias(normalized));
}

export function createAiNovelMetricModels(): LlmModelConfig[] {
  const modelsByKey = new Map<string, LlmModelConfig>();
  for (const alias of Object.values(AI_NOVEL_SCENE_ROUTE_ALIASES)) {
    if (modelsByKey.has(alias.providerModel)) {
      continue;
    }
    modelsByKey.set(alias.providerModel, {
      key: alias.providerModel,
      label: alias.providerModel,
      kind: alias.kind,
      strategy: "fixed",
      routes: [
        {
          provider: alias.provider,
          providerModel: alias.providerModel,
          enabled: true,
          weight: 100,
        },
      ],
    });
  }
  return [...modelsByKey.values()];
}

import type { LlmModelConfig, LlmModelKind } from "../shared/types.ts";

interface AiNovelSceneRouteAlias {
  kind: LlmModelKind;
  modelKey: string;
}

const AI_NOVEL_SCENE_ROUTE_ALIASES: Record<string, AiNovelSceneRouteAlias> = {
  "ainovel-free-creative": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-free-reasoning": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-plus-creative": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-plus-reasoning": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-super-creative": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-super-reasoning": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-lowcost-structured": {
    kind: "chat",
    modelKey: "qwen3.6-plus",
  },
  "ainovel-embedding-default": {
    kind: "embedding",
    modelKey: "text-embedding-v4",
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
    if (modelsByKey.has(alias.modelKey)) {
      continue;
    }
    modelsByKey.set(alias.modelKey, {
      key: alias.modelKey,
      label: alias.modelKey,
      kind: alias.kind,
      strategy: "fixed",
      routes: [
        {
          provider: "bailian",
          providerModel: alias.modelKey,
          enabled: true,
          weight: 100,
        },
      ],
    });
  }
  return [...modelsByKey.values()];
}

import type { AiNovelModelSelectionConfig } from "../../shared/types.ts";
import type { LlmRoutingIdentity } from "../../services/llm-manager.ts";
import { resolveLlmRoutingUnit } from "../../services/llm-routing-affinity.ts";

export interface AiNovelModelHealthInput {
  available: boolean;
  healthScore: number;
}

export interface AiNovelEffectiveModelWeight {
  modelKey: string;
  configuredWeight: number;
  effectiveWeight: number;
}

// This is a factor of the configured weight, yielding at most about 0.01%
// normalized traffic for a zero-health model alongside healthy models.
const MIN_MODEL_HEALTH_FACTOR = 0.0001;

export type AiNovelRoutingUnitResolver = typeof resolveLlmRoutingUnit;

export function selectAiNovelChatModelKey(
  config: AiNovelModelSelectionConfig,
  routingIdentity?: LlmRoutingIdentity,
  resolveRoutingUnit: AiNovelRoutingUnitResolver = resolveLlmRoutingUnit,
  modelHealth?: ReadonlyMap<string, AiNovelModelHealthInput>,
  excludedModelKeys?: ReadonlySet<string>,
): string {
  const models = buildAiNovelEffectiveModelWeights(
    config,
    modelHealth,
    excludedModelKeys,
  );
  const routingUnit = resolveRoutingUnit(
    routingIdentity?.did,
    routingIdentity?.uid,
  );
  const totalWeight = totalEffectiveWeight(models);
  if (totalWeight <= 0) {
    const fallbackModels = buildAiNovelEffectiveModelWeights(
      config,
      undefined,
      excludedModelKeys,
    );
    return selectByWeight(fallbackModels, routingUnit);
  }
  return selectByWeight(models, routingUnit);
}

function selectByWeight(
  models: AiNovelEffectiveModelWeight[],
  routingUnit: number,
): string {
  const totalWeight = totalEffectiveWeight(models);
  if (totalWeight <= 0) {
    throw new Error("No AINovel model remains after exclusions.");
  }
  const targetWeight = routingUnit * totalWeight;
  let upperBound = 0;
  for (const model of models) {
    upperBound += model.effectiveWeight;
    if (targetWeight < upperBound) {
      return model.modelKey;
    }
  }
  return models.at(-1)!.modelKey;
}

export function buildAiNovelEffectiveModelWeights(
  config: AiNovelModelSelectionConfig,
  modelHealth?: ReadonlyMap<string, AiNovelModelHealthInput>,
  excludedModelKeys?: ReadonlySet<string>,
): AiNovelEffectiveModelWeight[] {
  return config.chat.default.map((model) => {
    const health = modelHealth?.get(model.modelKey);
    // Keep a reachable, explicitly enabled but unhealthy model on a tiny probe
    // budget so recovery can be observed without restoring normal traffic.
    const healthFactor = health
      ? Math.max(
          Math.min(Math.max(health.healthScore, 0), 100) / 100,
          health.available ? MIN_MODEL_HEALTH_FACTOR : 0,
        )
      : 1;
    return {
      modelKey: model.modelKey,
      configuredWeight: model.weight,
      effectiveWeight: excludedModelKeys?.has(model.modelKey) || health?.available === false
        ? 0
        : model.weight * healthFactor,
    };
  });
}

function totalEffectiveWeight(models: AiNovelEffectiveModelWeight[]): number {
  return models.reduce((sum, model) => sum + model.effectiveWeight, 0);
}

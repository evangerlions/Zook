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
): string {
  const models = buildAiNovelEffectiveModelWeights(config, modelHealth);
  const routingUnit = resolveRoutingUnit(
    routingIdentity?.did,
    routingIdentity?.uid,
  );
  const totalWeight = models.reduce((sum, model) => sum + model.effectiveWeight, 0);
  if (totalWeight <= 0) {
    return selectAiNovelChatModelKey(config, routingIdentity, resolveRoutingUnit);
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
      effectiveWeight: health?.available === false
        ? 0
        : model.weight * healthFactor,
    };
  });
}

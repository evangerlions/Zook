import type { AiNovelModelSelectionConfig } from "../../shared/types.ts";
import type { LlmRoutingIdentity } from "../../services/llm-manager.ts";
import { resolveLlmRoutingUnit } from "../../services/llm-routing-affinity.ts";

export type AiNovelRoutingUnitResolver = typeof resolveLlmRoutingUnit;

export function selectAiNovelChatModelKey(
  config: AiNovelModelSelectionConfig,
  routingIdentity?: LlmRoutingIdentity,
  resolveRoutingUnit: AiNovelRoutingUnitResolver = resolveLlmRoutingUnit,
): string {
  const models = config.chat.default;
  const routingUnit = resolveRoutingUnit(
    routingIdentity?.did,
    routingIdentity?.uid,
  );
  const targetWeight = routingUnit * 100;
  let upperBound = 0;
  for (const model of models) {
    upperBound += model.weight;
    if (targetWeight < upperBound) {
      return model.modelKey;
    }
  }
  return models.at(-1)!.modelKey;
}

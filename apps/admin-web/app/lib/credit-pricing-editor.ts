import type { AdminAiNovelModelPointPricingDocument, AiNovelModelPointPricing, AiNovelModelPointPricingConfig, AiNovelPointPricingModelOption } from "./types/config";

export interface PricingRow extends AiNovelPointPricingModelOption, Omit<AiNovelModelPointPricing, "modelKey"> {}
export type ContextTier = NonNullable<PricingRow["contextTiers"]>[number];

export function hasInvalidRates(rows: PricingRow[]): boolean {
  const validRate = (rate: number) => Number.isSafeInteger(rate) && rate >= 0;
  return rows.some((row) => {
    const input = row.inputPointsPerMillionTokens;
    const output = row.outputPointsPerMillionTokens;
    const cache = row.cachedInputPointsPerMillionTokens;
    if ((input === undefined) !== (output === undefined)) return true;
    if ([input, output, cache].some((rate) => rate !== undefined && !validRate(rate))) return true;
    if (cache !== undefined && (input === undefined || cache > input)) return true;
    if (row.contextTiers?.length && input === undefined) return true;
    return row.contextTiers?.some((tier, index, tiers) =>
      !Number.isSafeInteger(tier.abovePromptTokens) || tier.abovePromptTokens < 0 ||
      (index > 0 && tier.abovePromptTokens <= tiers[index - 1].abovePromptTokens) ||
      !validRate(tier.inputPointsPerMillionTokens) || !validRate(tier.outputPointsPerMillionTokens)) ?? false;
  });
}

export function createRows(document: AdminAiNovelModelPointPricingDocument): PricingRow[] {
  return document.availableModels.map((model) => {
    const pricing = document.config.models.find((item) => item.modelKey === model.key);
    const { modelKey: _, ...rates } = pricing ?? { modelKey: model.key };
    return { ...model, ...structuredClone(rates) };
  });
}

export function toConfig(rows: PricingRow[]): AiNovelModelPointPricingConfig {
  return {
    schemaVersion: 1,
    models: rows.flatMap((row) => {
      const unpriced = row.inputPointsPerMillionTokens === undefined &&
        row.outputPointsPerMillionTokens === undefined &&
        row.cachedInputPointsPerMillionTokens === undefined && !row.contextTiers?.length;
      if (unpriced) return [];
      return [{
        modelKey: row.key,
        inputPointsPerMillionTokens: row.inputPointsPerMillionTokens,
        outputPointsPerMillionTokens: row.outputPointsPerMillionTokens,
        ...(row.cachedInputPointsPerMillionTokens === undefined ? {} : {
          cachedInputPointsPerMillionTokens: row.cachedInputPointsPerMillionTokens,
        }),
        ...(row.contextTiers === undefined ? {} : { contextTiers: structuredClone(row.contextTiers) }),
      }];
    }),
  };
}

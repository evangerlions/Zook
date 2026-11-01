import type { AiNovelModelPointPricingConfig, AiNovelModelPointPricingReference } from "../../shared/types.ts";

export const AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY = "ai_novel.model_point_pricing";
export const AI_NOVEL_POINT_PRICING_SCHEMA_VERSION = 1 as const;
export const AI_NOVEL_TOKENS_PER_POINT = 10_000;
// Legacy draft export, not used in pricing.
export const AI_NOVEL_POINTS_PER_USD = 10_000;

type Rate = readonly [key: string, cache: number | undefined, input: number, output: number];
/** Product-approved 2026-10-04 rates; not a provider USD invoice. */
const RATES: Rate[] = [
  ["deepseek-v4-flash", 0.1, 0.1, 0.2], ["deepseek-v4-pro", 0.1, 0.7, 1.5],
  ["qwen3.5-flash", undefined, 0.2, 1], ["qwen3.6-flash", undefined, 0.6, 4],
  ["qwen3.6-plus", undefined, 1, 6.5], ["qwen3.7-flash", 0.1, 0.1, 0.4],
  ["qwen3.7-plus", 0.2, 1, 4.5], ["qwen3.7-max", 1, 5, 15],
  ["qwen3.8-flash", 0.1, 0.5, 1.5], ["qwen3.8-max", 0.8, 6.5, 20],
  ["glm-5.2", 1, 1.5, 13.5], ["glm-5.3", 0.5, 4.5, 14.5],
  ["glm-5.3-flash", 0.1, 0.5, 1.5], ["kimi-k3", 2.5, 3.5, 43.5],
  ["minimax-m3", 0.2, 1, 4], ["doubao-seed-2.0-pro", undefined, 1.5, 7.5],
  ["doubao-seed-evolving", undefined, 3, 14.5],
];

export function createDefaultAiNovelPointPricingConfig(): AiNovelModelPointPricingConfig {
  return {
    schemaVersion: AI_NOVEL_POINT_PRICING_SCHEMA_VERSION,
    models: [
      ...RATES.map(([modelKey, cached, input, output]) => ({
        modelKey,
        inputPointsPerMillionTokens: Math.round(input * 100),
        outputPointsPerMillionTokens: Math.round(output * 100),
        ...(modelKey === "doubao-seed-2.0-pro" ? { contextTiers: [
          { abovePromptTokens: 32_000, inputPointsPerMillionTokens: 250, outputPointsPerMillionTokens: 1150 },
          { abovePromptTokens: 128_000, inputPointsPerMillionTokens: 450, outputPointsPerMillionTokens: 2300 },
        ] } : {}),
        ...(cached === undefined ? {} : { cachedInputPointsPerMillionTokens: Math.round(cached * 100) }),
      })),
      // Alibaba Cloud exact v4: $0.07–0.072/M input, no cache discount.
      { modelKey: "text-embedding-v4", inputPointsPerMillionTokens: 20, outputPointsPerMillionTokens: 0 },
    ],
  };
}

export function getAiNovelPointPricingReference(modelKey: string): AiNovelModelPointPricingReference {
  const rate = RATES.find(([key]) => key === modelKey);
  return {
    source: "product", match: "unavailable",
    note: rate
      ? "Approved multipliers, 2026-10-04. Unconfigured cache rate uses ordinary input pricing (no cache discount)."
      : "No approved rate; charging is unavailable until configured.",
  };
}

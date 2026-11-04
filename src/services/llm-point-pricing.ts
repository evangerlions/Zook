import type { LLMUsage } from "./llm-manager-types.ts";
import type { LlmPointPricing } from "../shared/types/llm.ts";

/**
 * Stores points in micro-points so per-request usage can be summed exactly.
 * Rates are integer points per million tokens; one token at a rate of 1 point
 * per million therefore contributes exactly one micro-point.
 */
export function calculateLlmPointMicros(
  usage: LLMUsage | undefined,
  pricing: LlmPointPricing | undefined,
): string | undefined {
  if (!usage || !isValidPricing(pricing)) return undefined;
  if (!isNonNegativeInteger(usage.promptTokens) || !isNonNegativeInteger(usage.completionTokens)) {
    return undefined;
  }
  const tier = [...(pricing.contextTiers ?? [])].sort((a, b) => b.abovePromptTokens - a.abovePromptTokens).find((item) => usage.promptTokens > item.abovePromptTokens);
  if (tier) pricing = { ...pricing, ...tier, contextTiers: undefined };
  if (!isValidPricing(pricing)) return undefined;

  const cached = usage.cachedInputTokens ?? 0;
  if (!isNonNegativeInteger(cached) || cached > usage.promptTokens) return undefined;
  const input = BigInt(usage.promptTokens - cached) * BigInt(pricing.inputPointsPerMillionTokens);
  const cache = BigInt(cached) * BigInt(pricing.cachedInputPointsPerMillionTokens ?? pricing.inputPointsPerMillionTokens);
  const output = BigInt(usage.completionTokens) * BigInt(pricing.outputPointsPerMillionTokens);
  return (input + cache + output).toString();
}

export function pointMicrosToPoints(pointMicros: string | undefined): number | undefined {
  if (pointMicros === undefined || !/^\d+$/.test(pointMicros)) return undefined;
  const value = BigInt(pointMicros);
  const whole = value / 1_000_000n;
  const remainder = value % 1_000_000n;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  const points = Number(whole) + Number(remainder) / 1_000_000;
  return Number.isFinite(points) ? points : undefined;
}

export function sumPointMicros(values: Array<string | undefined>): string | undefined {
  const present = values.filter((value): value is string => value !== undefined && /^\d+$/.test(value));
  if (!present.length) return undefined;
  return present.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function isValidPricing(pricing: LlmPointPricing | undefined): pricing is LlmPointPricing {
  return Boolean(
    pricing &&
      isNonNegativeInteger(pricing.inputPointsPerMillionTokens) &&
      (pricing.cachedInputPointsPerMillionTokens === undefined || isNonNegativeInteger(pricing.cachedInputPointsPerMillionTokens)) &&
      (pricing.contextTiers === undefined || (Array.isArray(pricing.contextTiers) && pricing.contextTiers.every((tier, index, tiers) =>
        tier && isNonNegativeInteger(tier.abovePromptTokens) &&
        isNonNegativeInteger(tier.inputPointsPerMillionTokens) && isNonNegativeInteger(tier.outputPointsPerMillionTokens) &&
        (index === 0 || tier.abovePromptTokens > tiers[index - 1]!.abovePromptTokens)))) &&
      isNonNegativeInteger(pricing.outputPointsPerMillionTokens),
  );
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

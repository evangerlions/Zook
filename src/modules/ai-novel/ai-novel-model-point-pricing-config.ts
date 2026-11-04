import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type { AiNovelModelPointPricingConfig } from "../../shared/types.ts";
import {
  AI_NOVEL_POINT_PRICING_SCHEMA_VERSION,
  createDefaultAiNovelPointPricingConfig,
} from "./ai-novel-model-point-pricing-defaults.ts";

export {
  AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
  AI_NOVEL_POINTS_PER_USD,
  createDefaultAiNovelPointPricingConfig,
  getAiNovelPointPricingReference,
} from "./ai-novel-model-point-pricing-defaults.ts";

export function parseStoredAiNovelModelPointPricingConfig(
  raw: string,
): AiNovelModelPointPricingConfig {
  try {
    return normalizeConfig(JSON.parse(raw), (message) => {
      throw new Error(message);
    });
  } catch (error) {
    throw new ApplicationError(
      502,
      "AI_UPSTREAM_CONFIG_INVALID",
      "Stored AINovel model point pricing config is invalid.",
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function normalizeAiNovelModelPointPricingAdminInput(
  input: unknown,
): AiNovelModelPointPricingConfig {
  return normalizeConfig(input, (message) => {
    badRequest("ADMIN_AINOVEL_MODEL_POINT_PRICING_INVALID", message);
  });
}

function normalizeConfig(
  input: unknown,
  invalid: (message: string) => never,
): AiNovelModelPointPricingConfig {
  const source = requireRecord(input, "Config must be a JSON object.", invalid);
  assertKnownFields(source, ["schemaVersion", "models"], "config", invalid);
  if (source.schemaVersion !== AI_NOVEL_POINT_PRICING_SCHEMA_VERSION) {
    invalid(`schemaVersion must be ${AI_NOVEL_POINT_PRICING_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(source.models)) {
    invalid("models must be an array.");
  }

  const seen = new Set<string>();
  const models = source.models.map((item, index) => {
    const model = requireRecord(item, `models[${index}] must be an object.`, invalid);
    assertKnownFields(
      model,
      ["modelKey", "contextTiers", "cachedInputPointsPerMillionTokens", "inputPointsPerMillionTokens", "outputPointsPerMillionTokens"],
      `models[${index}]`,
      invalid,
    );
    const modelKey = requireModelKey(model.modelKey, index, invalid);
    if (seen.has(modelKey)) {
      invalid(`Duplicate model key is not allowed: ${modelKey}.`);
    }
    seen.add(modelKey);

    const inputRate = model.inputPointsPerMillionTokens;
    const cacheRate = model.cachedInputPointsPerMillionTokens;
    const contextTiers = normalizeTiers(model.contextTiers, invalid);
    const outputRate = model.outputPointsPerMillionTokens;
    if ((inputRate === undefined) !== (outputRate === undefined)) {
      invalid(`Model ${modelKey} must configure both input and output rates, or neither.`);
    }
    if (inputRate === undefined || outputRate === undefined) {
      if (cacheRate !== undefined || contextTiers.length) invalid(`Model ${modelKey} cache rate and tiers require input and output rates.`);
      return { modelKey };
    }
    if (!isNonNegativeSafeInteger(inputRate) || !isNonNegativeSafeInteger(outputRate)) {
      invalid(`Model ${modelKey} rates must be non-negative safe integers.`);
    }
    if (cacheRate !== undefined && (!isNonNegativeSafeInteger(cacheRate) || cacheRate > inputRate)) {
      invalid(`Model ${modelKey} cache rate must be a non-negative integer no greater than input rate.`);
    }
    return {
      modelKey,
      ...(contextTiers.length ? { contextTiers } : {}),
      ...(cacheRate === undefined ? {} : { cachedInputPointsPerMillionTokens: cacheRate as number }),
      inputPointsPerMillionTokens: inputRate,
      outputPointsPerMillionTokens: outputRate,
    };
  });

  return {
    schemaVersion: AI_NOVEL_POINT_PRICING_SCHEMA_VERSION,
    models,
  };
}

function normalizeTiers(value: unknown, invalid: (message: string) => never) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid("contextTiers must be an array.");
  let previous = -1;
  return value.map((raw) => {
    const tier = requireRecord(raw, "Context tier must be an object.", invalid);
    assertKnownFields(tier, ["abovePromptTokens", "inputPointsPerMillionTokens", "outputPointsPerMillionTokens"], "tier", invalid);
    const threshold = tier.abovePromptTokens, input = tier.inputPointsPerMillionTokens, output = tier.outputPointsPerMillionTokens;
    if (!isNonNegativeSafeInteger(threshold) || threshold <= previous || !isNonNegativeSafeInteger(input) || !isNonNegativeSafeInteger(output)) {
      invalid("Context tiers require ascending safe integer thresholds and non-negative integer rates.");
    }
    previous = threshold as number;
    return { abovePromptTokens: threshold as number, inputPointsPerMillionTokens: input as number, outputPointsPerMillionTokens: output as number };
  });
}

function requireModelKey(
  value: unknown,
  index: number,
  invalid: (message: string) => never,
): string {
  const modelKey = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(modelKey)) {
    invalid(`models[${index}].modelKey is invalid.`);
  }
  return modelKey;
}

function requireRecord(
  value: unknown,
  message: string,
  invalid: (message: string) => never,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(message);
  }
  return value as Record<string, unknown>;
}

function assertKnownFields(
  source: Record<string, unknown>,
  allowed: string[],
  path: string,
  invalid: (message: string) => never,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(source).find((key) => !allowedSet.has(key));
  if (unknown) invalid(`${path} contains unsupported field: ${unknown}.`);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

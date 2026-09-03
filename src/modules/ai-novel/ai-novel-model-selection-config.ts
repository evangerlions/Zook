import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type { AiNovelModelSelectionConfig } from "../../shared/types.ts";

export const AI_NOVEL_MODEL_SELECTION_CONFIG_KEY =
  "ai_novel.model_selection";
export const AI_NOVEL_DEFAULT_CHAT_MODEL_KEY = "qwen3.6-plus";

const CONFIG_SCHEMA_VERSION = 1;
const WEIGHT_PRECISION = 100;

export function createDefaultAiNovelModelSelectionConfig(): AiNovelModelSelectionConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    chat: {
      default: [
        {
          modelKey: AI_NOVEL_DEFAULT_CHAT_MODEL_KEY,
          weight: 100,
        },
      ],
    },
  };
}

export function parseStoredAiNovelModelSelectionConfig(
  raw: string,
): AiNovelModelSelectionConfig {
  try {
    return normalizeConfig(JSON.parse(raw), (message) => {
      throw new Error(message);
    });
  } catch (error) {
    throw new ApplicationError(
      502,
      "AI_UPSTREAM_CONFIG_INVALID",
      "Stored AINovel model selection config is invalid.",
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function normalizeAiNovelModelSelectionAdminInput(
  input: unknown,
): AiNovelModelSelectionConfig {
  return normalizeConfig(input, (message) => {
    badRequest("ADMIN_AINOVEL_MODEL_SELECTION_INVALID", message);
  });
}

function normalizeConfig(
  input: unknown,
  invalid: (message: string) => never,
): AiNovelModelSelectionConfig {
  const source = requireRecord(
    input,
    "AINovel model selection must be a JSON object.",
    invalid,
  );
  assertKnownFields(source, ["schemaVersion", "chat"], "config", invalid);
  if (source.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    invalid(`schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  }

  const chat = requireRecord(
    source.chat,
    "chat must be a JSON object.",
    invalid,
  );
  assertKnownFields(chat, ["default"], "chat", invalid);
  const defaultModels = normalizeModels(chat.default, "chat.default", invalid);

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    chat: { default: defaultModels },
  };
}

function normalizeModels(
  value: unknown,
  path: string,
  invalid: (message: string) => never,
): AiNovelModelSelectionConfig["chat"]["default"] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(`${path} must contain at least one weighted model.`);
  }
  const seen = new Set<string>();
  const models = value.map((item, index) => {
    const source = requireRecord(
      item,
      `${path}[${index}] must be a JSON object.`,
      invalid,
    );
    assertKnownFields(
      source,
      ["modelKey", "weight"],
      `${path}[${index}]`,
      invalid,
    );
    const modelKey = requireString(
      source.modelKey,
      `${path}[${index}].modelKey is required.`,
      invalid,
    );
    if (seen.has(modelKey)) {
      invalid(`Duplicate AINovel model key is not allowed: ${modelKey}.`);
    }
    seen.add(modelKey);
    return {
      modelKey,
      weight: normalizeWeight(source.weight, path, index, invalid),
    };
  });
  const totalWeight = models.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.001) {
    invalid(
      `${path} weights must add up to 100, received ${totalWeight}.`,
    );
  }
  return models;
}

function normalizeWeight(
  value: unknown,
  path: string,
  index: number,
  invalid: (message: string) => never,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    invalid(`${path}[${index}].weight must be greater than 0.`);
  }
  const normalized = Math.round(value * WEIGHT_PRECISION) / WEIGHT_PRECISION;
  if (Math.abs(value - normalized) > 0.000001) {
    invalid(`${path}[${index}].weight must keep at most 2 decimals.`);
  }
  return normalized;
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

function requireString(
  value: unknown,
  message: string,
  invalid: (message: string) => never,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    invalid(message);
  }
  return normalized;
}

function assertKnownFields(
  source: Record<string, unknown>,
  allowed: string[],
  path: string,
  invalid: (message: string) => never,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(source).find((key) => !allowedSet.has(key));
  if (unknown) {
    invalid(`${path} contains unsupported field: ${unknown}.`);
  }
}

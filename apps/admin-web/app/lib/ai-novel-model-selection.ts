import type { AiNovelModelSelectionConfig } from "./types";
import { parseConfigText } from "./json.ts";

const WEIGHT_PRECISION = 100;

export function parseAiNovelModelSelectionText(
  rawText: string,
  availableModelKeys: Iterable<string>,
): AiNovelModelSelectionConfig {
  const root = parseConfigText(rawText);
  assertKnownFields(root, ["schemaVersion", "chat"], "配置");
  if (root.schemaVersion !== 1) {
    throw new Error("schemaVersion 必须为 1。");
  }

  const chat = requireRecord(root.chat, "chat 必须是 JSON object。");
  assertKnownFields(chat, ["default"], "chat");
  if (!Array.isArray(chat.default) || chat.default.length === 0) {
    throw new Error("chat.default 至少需要一个模型。");
  }

  const available = new Set(availableModelKeys);
  const seen = new Set<string>();
  const models = chat.default.map((item, index) => {
    const source = requireRecord(
      item,
      `chat.default[${index}] 必须是 JSON object。`,
    );
    assertKnownFields(source, ["modelKey", "weight"], `chat.default[${index}]`);
    const modelKey = requireString(
      source.modelKey,
      `chat.default[${index}].modelKey 不能为空。`,
    );
    if (!available.has(modelKey)) {
      throw new Error(`模型 ${modelKey} 不存在于当前 LLM Chat 模型列表。`);
    }
    if (seen.has(modelKey)) {
      throw new Error(`模型 Key 不能重复：${modelKey}。`);
    }
    seen.add(modelKey);
    return {
      modelKey,
      weight: normalizeWeight(source.weight, index),
    };
  });

  const totalWeight = models.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.001) {
    throw new Error(`所有 Weight 之和必须等于 100，当前为 ${totalWeight}。`);
  }

  return {
    schemaVersion: 1,
    chat: { default: models },
  };
}

function normalizeWeight(value: unknown, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`chat.default[${index}].weight 必须大于等于 0。`);
  }
  const normalized = Math.round(value * WEIGHT_PRECISION) / WEIGHT_PRECISION;
  if (Math.abs(value - normalized) > 0.000001) {
    throw new Error(`chat.default[${index}].weight 最多保留两位小数。`);
  }
  return normalized;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function assertKnownFields(
  source: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(source).find((key) => !allowedSet.has(key));
  if (unknown) {
    throw new Error(`${path} 包含不支持的字段：${unknown}。`);
  }
}

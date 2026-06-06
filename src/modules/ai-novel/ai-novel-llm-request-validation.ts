import { badRequest } from "../../shared/errors.ts";
import type {
  LLMMessage,
  LLMToolCall,
} from "../../services/llm-manager.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNoClientModelSelection(body: Record<string, unknown>): void {
  for (const field of [
    "model",
    "modelKey",
    "providerModel",
    "tier",
    "routingTier",
    "modelTier",
  ]) {
    if (body[field] !== undefined) {
      badRequest(
        "REQ_INVALID_BODY",
        `${field} is not allowed. Use sceneKey or scene_key to select the AINovel scene.`,
      );
    }
  }
}

export function requireSceneKey(body: Record<string, unknown>): string {
  const candidates = [
    ["scene_key", body.scene_key],
    ["sceneKey", body.sceneKey],
  ] as const;
  const provided = candidates.filter(
    ([, value]) => typeof value === "string" && value.trim(),
  );
  if (!provided.length) {
    badRequest("REQ_INVALID_BODY", "sceneKey must be a non-empty string.");
  }

  const first = provided[0]!;
  const sceneKey = first[1].trim();
  const conflicting = provided.find(([, value]) => value.trim() !== sceneKey);
  if (conflicting) {
    badRequest(
      "REQ_INVALID_BODY",
      "scene_key and sceneKey must resolve to the same scene.",
    );
  }
  return sceneKey;
}

export function normalizeMessages(value: unknown): LLMMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    badRequest("REQ_INVALID_BODY", "messages must contain at least one item.");
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      badRequest("REQ_INVALID_BODY", "Each message must be a JSON object.");
    }

    const role = item.role;
    const content = item.content;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
      badRequest("REQ_INVALID_BODY", `Unsupported LLM role: ${String(role)}.`);
    }
    if (typeof content !== "string") {
      badRequest("REQ_INVALID_BODY", "Each message content must be a string.");
    }

    const toolCallId = readOptionalString(item.toolCallId);
    const toolCalls = normalizeToolCalls(item.toolCalls);
    const reasoningContent =
      readOptionalString(item.reasoningContent) ??
      readOptionalString(item.reasoning_content);
    if (role === "tool") {
      if (!toolCallId) {
        badRequest("REQ_INVALID_BODY", "tool messages require toolCallId.");
      }
      if (!content.trim()) {
        badRequest("REQ_INVALID_BODY", "tool message content must be a non-empty string.");
      }
    } else if (!content.trim() && toolCalls.length === 0 && !(role === "assistant" && reasoningContent)) {
      badRequest(
        "REQ_INVALID_BODY",
        "assistant/system/user messages need content, toolCalls, or assistant reasoningContent.",
      );
    }

    return {
      role,
      content,
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(role === "assistant" && reasoningContent ? { reasoningContent } : {}),
    };
  });
}

export function normalizeToolCalls(value: unknown): LLMToolCall[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    badRequest("REQ_INVALID_BODY", "toolCalls must be an array when provided.");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      badRequest("REQ_INVALID_BODY", `toolCalls[${index}] must be a JSON object.`);
    }
    const id = readOptionalString(item.id);
    const name = readOptionalString(item.name);
    if (!id || !name) {
      badRequest("REQ_INVALID_BODY", `toolCalls[${index}] requires id and name.`);
    }
    return {
      id,
      name,
      input: isRecord(item.input) ? item.input : {},
    };
  });
}

export function normalizeEmbeddingInput(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    badRequest(
      "AI_EMBEDDING_INPUT_INVALID",
      "input must be a non-empty string array.",
    );
  }

  return value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      badRequest(
        "AI_EMBEDDING_INPUT_INVALID",
        "input must contain non-empty strings only.",
      );
    }
    return item.trim();
  });
}

export function optionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    badRequest("REQ_INVALID_BODY", `${fieldName} must be a number when provided.`);
  }
  return value;
}

export function optionalPositiveInteger(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0 || !Number.isInteger(value)) {
    badRequest(
      "REQ_INVALID_BODY",
      `${fieldName} must be a positive integer when provided.`,
    );
  }
  return value;
}

export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

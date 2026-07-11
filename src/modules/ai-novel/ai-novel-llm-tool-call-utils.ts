import { ApplicationError } from "../../shared/errors.ts";
import type { LLMToolCall } from "../../services/llm-manager.ts";
import { isRecord, readOptionalString } from "./ai-novel-llm-request-validation.ts";

export function aiNovelUsageOwner(options: {
  userId?: string;
}): { usageOwner: { appId: "ai_novel"; userId: string } } | {} {
  return options.userId
    ? { usageOwner: { appId: "ai_novel", userId: options.userId } }
    : {};
}

export function buildAiNovelFallbackToolCallId(
  sceneRouteKey: string,
  phase: "kickoff" | "prompted",
  index: number,
): string {
  return `${sceneRouteKey}_${phase}_tool_${index}`;
}

export function normalizeAiNovelToolCallId(value: unknown, fallbackId: string): string {
  return readOptionalString(value) ?? fallbackId;
}

export function normalizeAiNovelPromptedToolCall(
  toolCall: LLMToolCall,
  sceneRouteKey: string,
  fallbackIndex: number,
): LLMToolCall {
  const id = normalizeAiNovelToolCallId(
    toolCall.id,
    buildAiNovelFallbackToolCallId(sceneRouteKey, "prompted", fallbackIndex),
  );
  const name = readOptionalString(toolCall.name);
  if (!name) {
    throw new ApplicationError(
      502,
      "LLM_PROVIDER_RESPONSE_INVALID",
      "Provider emitted a prompted-scene tool call without a name.",
      { sceneRouteKey, toolCallId: id },
    );
  }
  return {
    id,
    name,
    input: isRecord(toolCall.input) ? toolCall.input : {},
  };
}

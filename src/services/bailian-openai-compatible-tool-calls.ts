import { ApplicationError } from "../shared/errors.ts";
import type { LLMCompletionResult } from "./llm-manager.ts";
import type { OpenAICompatibleChoice } from "./bailian-openai-compatible-types.ts";
import { buildFallbackToolCallId, isRecord, readOptionalNonBlankString, throwProviderResponseInvalid } from "./bailian-openai-compatible-utils.ts";

export function parseBailianCompletionToolCalls(
  toolCalls: NonNullable<OpenAICompatibleChoice["message"]>["tool_calls"],
  modelKey: string,
  providerName: string,
): NonNullable<LLMCompletionResult["toolCalls"]> {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  return toolCalls.map((toolCall, index) => {
    const name = readOptionalNonBlankString(toolCall.function?.name);
    if (!name) {
      throwProviderResponseInvalid(
        "Completion response tool call is missing a function name.",
        undefined,
        providerName,
      );
    }

    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(toolCall.function?.arguments || "{}");
      if (!isRecord(parsed)) {
        throwProviderResponseInvalid(
          "Completion response tool call arguments must be a JSON object.",
          undefined,
          providerName,
        );
      }
      input = parsed;
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throwProviderResponseInvalid(
        "Completion response tool call arguments are not valid JSON.",
        {
          cause: error instanceof Error ? error.message : String(error),
          toolName: name,
        },
        providerName,
      );
    }

    return {
      id:
        readOptionalNonBlankString(toolCall.id) ??
        buildFallbackToolCallId(modelKey, index),
      name,
      input,
    };
  });
}

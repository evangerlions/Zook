import { ApplicationError } from "../../shared/errors.ts";
import type {
  LLMCompletionResult,
  LLMManager,
  LLMMessage,
  LlmRoutingIdentity,
  LLMToolCall,
} from "../../services/llm-manager.ts";
import {
  compactAiNovelContext,
  latestUserMessageIndex,
} from "./ai-novel-context-compaction.ts";

const STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS = 20_000;
const REQUIRED_TOOL_STREAM_ATTEMPTS = 2;

export async function completeRequiredToolViaStream(
  llmManager: LLMManager,
  input: {
    sceneRouteKey: string;
    modelKey: string;
    messages: LLMMessage[];
    temperature: number;
    maxTokens: number;
    providerOptions?: Record<string, unknown>;
    messagesAlreadyCompacted?: boolean;
    usageOwner?: { appId: string; userId: string };
    routingIdentity?: LlmRoutingIdentity;
    forcedToolName: string;
  },
): Promise<LLMCompletionResult> {
  let messages = input.messages;
  let lastResult: LLMCompletionResult | undefined;
  let protectedRoundStartIndex: number | undefined;

  for (let attempt = 1; attempt <= REQUIRED_TOOL_STREAM_ATTEMPTS; attempt += 1) {
    const providerMessages =
      attempt === 1 && input.messagesAlreadyCompacted
        ? messages
        : compactAiNovelContext({
            messages,
            providerOptions: input.providerOptions,
            maxTokens: input.maxTokens,
            ...(protectedRoundStartIndex === undefined
              ? {}
              : { latestRoundStartIndex: protectedRoundStartIndex }),
          }).messages;
    if (protectedRoundStartIndex === undefined) {
      const latestIndex = latestUserMessageIndex(providerMessages);
      if (latestIndex >= 0) protectedRoundStartIndex = latestIndex;
    }
    const result = await llmManager.completeViaStream(
      {
        modelKey: input.modelKey,
        messages: providerMessages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
        ...(input.usageOwner ? { usageOwner: input.usageOwner } : {}),
        ...(input.routingIdentity
          ? { routingIdentity: input.routingIdentity }
          : {}),
      },
      { firstContentTimeoutMs: STREAMED_COMPLETION_FIRST_CONTENT_TIMEOUT_MS },
    );
    lastResult = result;
    if (findToolCall(result, input.forcedToolName)) {
      return result;
    }

    messages = [
      ...providerMessages,
      {
        role: "assistant",
        content: result.text,
        ...(result.reasoningText ? { reasoningContent: result.reasoningText } : {}),
      },
      {
        role: "user",
        content: buildRequiredToolRetryMessage(input.forcedToolName),
      },
    ];
  }

  throw new ApplicationError(
    502,
    "AI_UPSTREAM_RESPONSE_INVALID",
    `Upstream model did not return required tool call: ${input.forcedToolName}.`,
    {
      sceneRouteKey: input.sceneRouteKey,
      requiredToolName: input.forcedToolName,
      attempts: REQUIRED_TOOL_STREAM_ATTEMPTS,
      finishReason: lastResult?.finishReason,
    },
  );
}

export function resolvePromptAssemblyCompletionText(
  forcedToolName: string | undefined,
  result: LLMCompletionResult,
): string {
  if (!forcedToolName) {
    return result.text;
  }
  const toolCall = findToolCall(result, forcedToolName);
  if (!toolCall) {
    throw new ApplicationError(
      502,
      "AI_UPSTREAM_RESPONSE_INVALID",
      `Upstream model did not return required tool call: ${forcedToolName}.`,
      {
        requiredToolName: forcedToolName,
        finishReason: result.finishReason,
      },
    );
  }
  return JSON.stringify(toolCall.input ?? {});
}

function findToolCall(
  result: Pick<LLMCompletionResult, "toolCalls">,
  toolName: string,
): LLMToolCall | undefined {
  return result.toolCalls?.find((toolCall) => toolCall.name === toolName);
}

function buildRequiredToolRetryMessage(toolName: string): string {
  return [
    `The previous assistant turn did not call ${toolName}.`,
    `You must now call ${toolName} exactly once with the required structured arguments.`,
    "Do not answer with plain text or markdown.",
  ].join(" ");
}

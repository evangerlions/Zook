import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { LLMMessage } from "../../services/llm-manager.ts";
import { ApplicationError } from "../../shared/errors.ts";
import type { AiNovelConversationOutcome } from "../../shared/types.ts";
import type { AiNovelConversationDebugMetadata } from "./ai-novel-conversation-debug.ts";
import type { AiNovelConversationRecordService } from "./ai-novel-conversation-record.service.ts";

export interface AiNovelConversationResultInput {
  recordService?: AiNovelConversationRecordService;
  logger?: StructuredLogger;
  userId?: string;
  did?: string;
  requestId?: string;
  messageId?: string;
  sessionId?: string;
  turnId?: string;
  sceneKey: string;
  userText: string;
  assistantText: string;
  outcome: AiNovelConversationOutcome;
  errorCode?: string;
  errorMessage?: string;
  serverCompacted: boolean;
  conversationDebug?: AiNovelConversationDebugMetadata;
}

export async function recordAiNovelConversationResult(
  input: AiNovelConversationResultInput,
): Promise<void> {
  if (!input.recordService || !input.userId || !input.requestId || !input.userText) {
    return;
  }
  try {
    await input.recordService.recordConversationResult({
      userId: input.userId,
      did: input.did,
      requestId: input.requestId,
      messageId: input.messageId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      sceneKey: input.sceneKey,
      userText: input.userText,
      assistantText: input.assistantText,
      outcome: input.outcome,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      serverCompacted: input.serverCompacted,
      systemPrompt: input.conversationDebug?.systemPrompt,
      tools: input.conversationDebug?.tools,
    });
  } catch (error) {
    input.logger?.warn("AINovel conversation record write failed", {
      requestId: input.requestId,
      sceneKey: input.sceneKey,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function conversationFailureFields(error: unknown): {
  errorCode: string;
  errorMessage: string;
} {
  const errorCode = error instanceof ApplicationError
    ? error.code
    : error instanceof Error
      ? error.name
      : "UNKNOWN_ERROR";
  const rawMessage = error instanceof Error ? error.message : String(error);
  return {
    errorCode,
    errorMessage: rawMessage,
  };
}

export function latestUserMessageText(messages: LLMMessage[]): string {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content
    ?.trim() ?? "";
}

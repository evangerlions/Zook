export interface AiNovelConversationRecordIds {
  messageId?: string;
  sessionId?: string;
  turnId?: string;
}

export function extractAiNovelConversationRecordIds(
  body: Record<string, unknown>,
): AiNovelConversationRecordIds {
  const context = isRecord(body.context) ? body.context : {};
  const latestUserMessage = latestUserMessageOf(body.messages);
  const messageId = firstId(
    latestUserMessage?.messageId,
    latestUserMessage?.message_id,
    latestUserMessage?.id,
    context.messageId,
    context.message_id,
    body.messageId,
    body.message_id,
  );
  const sessionId = firstId(
    context.sessionId,
    context.session_id,
    body.sessionId,
    body.session_id,
  );
  const turnId = firstId(
    context.turnId,
    context.turn_id,
    body.turnId,
    body.turn_id,
  );
  return {
    ...(messageId ? { messageId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(turnId ? { turnId } : {}),
  };
}

function latestUserMessageOf(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...value].reverse().find((item) =>
    isRecord(item) && item.role === "user",
  ) as Record<string, unknown> | undefined;
}

function firstId(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized && normalized.length <= 160) return normalized;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

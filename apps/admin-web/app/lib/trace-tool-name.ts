import type { AiNovelTraceMessage } from "./types";

type TraceRecord = Record<string, unknown>;

export function resolveTraceToolName(
  message: AiNovelTraceMessage,
  messages: readonly AiNovelTraceMessage[] = [message],
): string | undefined {
  const directName = readToolName(message);
  if (directName) return directName;

  const toolCallId = readText(message.toolCallId) ?? readText(message.tool_call_id);
  if (!toolCallId) return undefined;

  for (const candidate of messages) {
    if (candidate.role !== "assistant") continue;
    const toolCalls = readArray(candidate.toolCalls ?? candidate.tool_calls);
    for (const toolCall of toolCalls) {
      if (readText(toolCall.id) !== toolCallId) continue;
      return readToolName(toolCall);
    }
  }
  return undefined;
}

function readToolName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ["toolName", "toolCallName", "name"]) {
    const name = readText(record[key]);
    if (name) return name;
  }
  const functionRecord = asRecord(record.function);
  return readText(functionRecord?.name);
}

function readArray(value: unknown): TraceRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is TraceRecord => Boolean(item)) : [];
}

function asRecord(value: unknown): TraceRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as TraceRecord : undefined;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

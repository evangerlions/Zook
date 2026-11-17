import type { AiNovelTraceMessage } from "./types";

type TraceRecord = Record<string, unknown>;

export function resolveTraceToolName(
  message: AiNovelTraceMessage,
  messages: readonly AiNovelTraceMessage[] = [message],
): string | undefined {
  const directName = readToolName(message);
  if (directName) return directName;

  return readToolName(findToolCall(message, messages));
}

export type TraceToolInput = { available: true; value: unknown } | { available: false };

export function resolveTraceToolInput(
  message: AiNovelTraceMessage,
  messages: readonly AiNovelTraceMessage[] = [message],
): TraceToolInput {
  const call = findToolCall(message, messages);
  const functionCall = asRecord(call?.function);
  for (const source of [call, functionCall, message]) {
    if (!source) continue;
    for (const key of ["input", "arguments"]) {
      if (Object.hasOwn(source, key)) return { available: true, value: parseArguments(source[key]) };
    }
  }
  return { available: false };
}

function findToolCall(message: AiNovelTraceMessage, messages: readonly AiNovelTraceMessage[]): TraceRecord | undefined {
  const toolCallId = readText(message.toolCallId) ?? readText(message.tool_call_id);
  if (!toolCallId) return undefined;
  const resultIndex = messages.indexOf(message);
  const end = resultIndex < 0 ? messages.length : resultIndex;
  for (let index = end - 1; index >= 0; index--) {
    const candidate = messages[index];
    if (candidate?.role !== "assistant") continue;
    const call = readArray(candidate.toolCalls ?? candidate.tool_calls).find((item) => readText(item.id) === toolCallId);
    if (call) return call;
  }
  return undefined;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
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

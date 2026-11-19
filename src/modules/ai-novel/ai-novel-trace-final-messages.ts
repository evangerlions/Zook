import type { AiNovelTraceMessage } from "./ai-novel-debug-trace-view-model.ts";

type RecordValue = Record<string, unknown>;

export function traceFinalMessages(
  request: RecordValue,
  agentEvents: readonly RecordValue[],
): AiNovelTraceMessage[] {
  const events = objects(request.events);
  const calls = events
    .filter((event) => event.type === "tool_call")
    .map((event) => record(event.toolCall))
    .filter((call): call is RecordValue => Boolean(call));
  const completion = record(request.completion);
  const content = typeof completion?.content === "string" ? completion.content : "";
  if (!calls.length && !content) return [];

  const result: AiNovelTraceMessage[] = [{ role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) }];
  for (const call of calls) {
    const event = agentEvents.find((item) => item.type === "tool_execution_end" && item.toolCallId === call.id);
    const text = objects(event?.content).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
    result.push({
      role: "tool",
      toolCallId: call.id,
      toolName: call.name,
      content: event ? (text || event.content || "") : "（未记录工具执行结果）",
      ...(event ? { isError: event.isError } : { resultUnavailable: true }),
    });
  }
  return result;
}

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function objects(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => Boolean(item)) : [];
}

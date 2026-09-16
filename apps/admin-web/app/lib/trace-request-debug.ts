import type { AiNovelTraceMessage, AiNovelTraceTurn } from "./types";

export interface TraceDebugTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface TraceRequestDebugContext {
  systemPrompt?: string;
  tools: TraceDebugTool[];
}

export function collectTraceRequestDebugContext(
  turn: AiNovelTraceTurn,
): TraceRequestDebugContext {
  const systemPrompts = new Set<string>();
  const tools = new Map<string, TraceDebugTool>();
  for (const request of turn.requests) {
    for (const message of [
      ...request.messages,
      ...collectMessages(request.raw),
    ]) {
      if (message.role !== "system") continue;
      const content = stringifyContent(message.content).trim();
      if (content) systemPrompts.add(content);
    }
    for (const tool of collectTools(request.raw)) {
      tools.set(tool.name, tool);
    }
  }
  return {
    ...(systemPrompts.size > 0
      ? { systemPrompt: [...systemPrompts].join("\n\n") }
      : {}),
    tools: [...tools.values()],
  };
}

function collectMessages(raw: unknown): AiNovelTraceMessage[] {
  const messages: AiNovelTraceMessage[] = [];
  visit(raw, (value, key) => {
    if (key !== "messages" || !Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const message = item as Record<string, unknown>;
      if (typeof message.role === "string" && "content" in message) {
        messages.push(message as AiNovelTraceMessage);
      }
    }
  });
  return messages;
}

function collectTools(raw: unknown): TraceDebugTool[] {
  const tools: TraceDebugTool[] = [];
  visit(raw, (value, key) => {
    if (key !== "tools" || !Array.isArray(value)) return;
    for (const item of value) {
      const tool = normalizeTool(item);
      if (tool) tools.push(tool);
    }
  });
  return tools;
}

function normalizeTool(value: unknown): TraceDebugTool | undefined {
  const outer = asRecord(value);
  if (!outer) return undefined;
  const functionRecord = asRecord(outer.function) ?? outer;
  const name = readText(functionRecord.name);
  if (!name) return undefined;
  const parameters = functionRecord.parameters ?? functionRecord.inputSchema;
  return {
    name,
    description: readText(functionRecord.description) ?? "",
    inputSchema: asRecord(parameters) ?? {},
  };
}

function visit(value: unknown, callback: (value: unknown, key: string) => void, seen = new Set<object>(), key = ""): void {
  callback(value, key);
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback, seen, "");
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    visit(childValue, callback, seen, childKey);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

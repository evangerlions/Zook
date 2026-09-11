import type { AiNovelDebugTraceSession } from "./ai-novel-debug-trace.service.ts";

export type AiNovelTraceDiffKind = "same" | "added" | "removed" | "meta";

export interface AiNovelTraceDiffLine {
  kind: AiNovelTraceDiffKind;
  text: string;
}

export interface AiNovelTraceMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface AiNovelTraceRequest {
  id: string;
  index: number;
  sceneKey?: string;
  status: string;
  capturedAt: string;
  messages: AiNovelTraceMessage[];
  events: Record<string, unknown>[];
  model?: string;
  transport?: string;
  tokenCount?: number;
  durationMs?: number;
  toolNames: string[];
  raw: Record<string, unknown>;
}

export interface AiNovelTraceTurn {
  id: string;
  index: number;
  status: string;
  capturedAt: string;
  userMessage?: AiNovelTraceMessage;
  messages: AiNovelTraceMessage[];
  requests: AiNovelTraceRequest[];
  model?: string;
  transport?: string;
  tokenCount?: number;
  durationMs?: number;
  toolNames: string[];
  contextDiff: AiNovelTraceDiffLine[];
  raw: Record<string, unknown>;
}

export interface AiNovelDebugTraceViewModel {
  turns: AiNovelTraceTurn[];
}

interface CollectedRequest {
  raw: Record<string, unknown>;
  capturedAt: string;
  captureStatus: string;
}

export function buildAiNovelDebugTraceViewModel(
  session: AiNovelDebugTraceSession,
): AiNovelDebugTraceViewModel {
  const requests = session.captures.flatMap((capture) =>
    collectRequests(capture.trace).map((request) => ({
      ...request,
      capturedAt: capture.capturedAt,
      captureStatus: capture.status,
    })),
  );
  const groups: CollectedRequest[][] = [];
  for (const request of requests) {
    const current = groups.at(-1);
    if (current && belongsToSameTurn(current, request)) {
      current.push(request);
    } else {
      groups.push([request]);
    }
  }

  const turns: AiNovelTraceTurn[] = [];
  for (const [index, group] of groups.entries()) {
    const normalizedRequests = group.map((request, requestIndex) =>
      normalizeRequest(request, requestIndex),
    );
    const latest = normalizedRequests.at(-1);
    const previous = turns.at(-1);
    const toolNames = uniqueStrings(
      normalizedRequests.flatMap((request) => request.toolNames),
    );
    turns.push({
      id: turnId(group, index),
      index,
      status: latest?.status ?? group.at(-1)?.captureStatus ?? "unknown",
      capturedAt: group.at(-1)?.capturedAt ?? "",
      userMessage: latest?.messages.findLast((message) => message.role === "user"),
      messages: latest?.messages ?? [],
      requests: normalizedRequests,
      ...(latest?.model ? { model: latest.model } : {}),
      ...(latest?.transport ? { transport: latest.transport } : {}),
      ...(sumNumbers(normalizedRequests.map((request) => request.tokenCount))
        ? { tokenCount: sumNumbers(normalizedRequests.map((request) => request.tokenCount)) }
        : {}),
      ...(sumNumbers(normalizedRequests.map((request) => request.durationMs))
        ? { durationMs: sumNumbers(normalizedRequests.map((request) => request.durationMs)) }
        : {}),
      toolNames,
      contextDiff: diffContext(previous?.requests.at(-1), latest),
      raw: {
        requests: normalizedRequests.map((request) => request.raw),
      },
    });
  }
  return { turns };
}

function collectRequests(
  trace: Record<string, unknown>,
): CollectedRequest[] {
  const requests: CollectedRequest[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown, key: string, capturedAt = "", captureStatus = "unknown") => {
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      if (key === "modelRequests" || key === "requests" || key === "runs") {
        for (const item of value) {
          if (isRequest(item)) {
            requests.push({ raw: item, capturedAt, captureStatus });
          } else {
            visit(item, "", capturedAt, captureStatus);
          }
        }
        return;
      }
      for (const item of value) visit(item, "", capturedAt, captureStatus);
      return;
    }
    const object = value as Record<string, unknown>;
    if (key === "" && isRequest(object) && !hasRequestCollection(object)) {
      requests.push({ raw: object, capturedAt, captureStatus });
      return;
    }
    for (const [nextKey, nextValue] of Object.entries(object)) {
      visit(nextValue, nextKey, capturedAt, captureStatus);
    }
  };
  visit(trace, "");
  return requests;
}

function hasRequestCollection(value: Record<string, unknown>): boolean {
  return Array.isArray(value.modelRequests) || Array.isArray(value.requests) || Array.isArray(value.runs);
}

function isRequest(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Boolean(
    item.sceneKey || item.stepName || item.messages || item.events ||
    item.context || item.piContext || item.requestIndex,
  );
}

function belongsToSameTurn(
  group: CollectedRequest[],
  next: CollectedRequest,
): boolean {
  const previous = group.at(-1);
  if (!previous) return false;
  const previousTurnId = explicitTurnId(previous.raw);
  const nextTurnId = explicitTurnId(next.raw);
  if (previousTurnId || nextTurnId) return previousTurnId === nextTurnId;
  const previousMessages = requestMessages(previous.raw);
  const nextMessages = requestMessages(next.raw);
  if (previousMessages.length === 0 || nextMessages.length === 0) return false;
  return (
    userMessageCount(previousMessages) === userMessageCount(nextMessages) &&
    latestUserContent(previousMessages) === latestUserContent(nextMessages)
  );
}

function normalizeRequest(
  collected: CollectedRequest,
  index: number,
): AiNovelTraceRequest {
  const raw = collected.raw;
  const messages = requestMessages(raw);
  const events = asObjectArray(raw.events);
  const status = asText(raw.status) ?? collected.captureStatus;
  const usage = latestUsage(raw, events);
  const startedAt = parseDate(raw.startedAt);
  const endedAt = parseDate(raw.endedAt);
  return {
    id: `${asText(raw.requestId) ?? asText(raw.requestIndex) ?? index + 1}-${collected.capturedAt}`,
    index,
    ...(asText(raw.sceneKey) ? { sceneKey: asText(raw.sceneKey) } : {}),
    status,
    capturedAt: collected.capturedAt,
    messages,
    events,
    ...(asText(raw.providerModel) ? { model: asText(raw.providerModel) } : {}),
    ...(asText(raw.api) ? { transport: asText(raw.api) } : {}),
    ...(usage !== undefined ? { tokenCount: usage } : {}),
    ...(startedAt && endedAt
      ? { durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()) }
      : {}),
    toolNames: uniqueStrings(events.flatMap(toolNameFromEvent)),
    raw,
  };
}

function latestUsage(
  raw: Record<string, unknown>,
  events: Record<string, unknown>[],
): number | undefined {
  const candidates = [
    raw.usage,
    raw.completion && typeof raw.completion === "object" && !Array.isArray(raw.completion)
      ? (raw.completion as Record<string, unknown>).usage
      : undefined,
    ...events.map((event) => event.usage),
  ];
  for (const value of candidates.reverse()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const usage = value as Record<string, unknown>;
    for (const key of ["totalTokens", "total_tokens", "outputTokens", "output_tokens"]) {
      if (typeof usage[key] === "number" && Number.isFinite(usage[key])) {
        return usage[key] as number;
      }
    }
  }
  return undefined;
}

function toolNameFromEvent(event: Record<string, unknown>): string[] {
  const type = asText(event.type);
  if (!type?.includes("tool_call")) return [];
  return [
    asText(event.toolCallName),
    asText(event.toolName),
    event.toolCall && typeof event.toolCall === "object" && !Array.isArray(event.toolCall)
      ? asText((event.toolCall as Record<string, unknown>).name)
      : undefined,
  ].filter((value): value is string => Boolean(value));
}

function parseDate(value: unknown): Date | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

function requestMessages(raw: Record<string, unknown>): AiNovelTraceMessage[] {
  const direct = asMessages(raw.messages);
  if (direct.length > 0) return direct;
  for (const key of ["context", "piContext", "requestContext"]) {
    const nested = raw[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const messages = asMessages((nested as Record<string, unknown>).messages);
      if (messages.length > 0) return messages;
    }
  }
  return [];
}

function asMessages(value: unknown): AiNovelTraceMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AiNovelTraceMessage => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const message = item as Record<string, unknown>;
    return typeof message.role === "string" && "content" in message;
  });
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item)),
  );
}

function explicitTurnId(raw: Record<string, unknown>): string | undefined {
  for (const value of [
    raw.turnId,
    nestedValue(raw, "context", "turnId"),
    nestedValue(raw, "requestContext", "turnId"),
    nestedValue(raw, "piContext", "turnId"),
  ]) {
    const text = asText(value);
    if (text) return text;
  }
  return undefined;
}

function nestedValue(raw: Record<string, unknown>, key: string, nestedKey: string): unknown {
  const value = raw[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[nestedKey]
    : undefined;
}

function userMessageCount(messages: AiNovelTraceMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

function latestUserContent(messages: AiNovelTraceMessage[]): string {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content
    ?.toString() ?? "";
}

function turnId(group: CollectedRequest[], index: number): string {
  return explicitTurnId(group[0]!.raw) ?? `turn-${index + 1}`;
}

function diffContext(
  previous: AiNovelTraceRequest | undefined,
  current: AiNovelTraceRequest | undefined,
): AiNovelTraceDiffLine[] {
  if (!current) return [];
  const currentLines = contextLines(current);
  if (!previous) {
    return [
      { kind: "meta", text: "Initial turn; no previous context to compare." },
      ...currentLines.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  const previousLines = contextLines(previous);
  return greedyDiff(previousLines, currentLines);
}

function contextLines(request: AiNovelTraceRequest): string[] {
  const raw = request.raw;
  const context: Record<string, unknown> = {
    ...(asText(raw.sceneKey) ? { sceneKey: raw.sceneKey } : {}),
    messages: request.messages,
    ...(raw.context && typeof raw.context === "object" && !Array.isArray(raw.context)
      ? { context: raw.context }
      : {}),
    ...(Array.isArray(raw.suppliedTools) ? { suppliedTools: raw.suppliedTools } : {}),
    ...(Array.isArray(raw.tools) ? { tools: raw.tools } : {}),
    ...(typeof raw.temperature === "number" ? { temperature: raw.temperature } : {}),
    ...(typeof raw.maxTokens === "number" ? { maxTokens: raw.maxTokens } : {}),
  };
  return JSON.stringify(context, null, 2).split("\n");
}

function greedyDiff(previous: string[], current: string[]): AiNovelTraceDiffLine[] {
  const output: AiNovelTraceDiffLine[] = [];
  let left = 0;
  let right = 0;
  const window = 24;
  while (left < previous.length || right < current.length) {
    if (previous[left] === current[right]) {
      output.push({ kind: "same", text: current[right]! });
      left += 1;
      right += 1;
      continue;
    }
    const nextRight = findLine(current, previous[left], right + 1, window);
    const nextLeft = findLine(previous, current[right], left + 1, window);
    if (nextRight !== -1 && (nextLeft === -1 || nextRight - right <= nextLeft - left)) {
      while (right < nextRight) output.push({ kind: "added", text: current[right++]! });
      continue;
    }
    if (nextLeft !== -1) {
      while (left < nextLeft) output.push({ kind: "removed", text: previous[left++]! });
      continue;
    }
    if (left < previous.length) output.push({ kind: "removed", text: previous[left++]! });
    if (right < current.length) output.push({ kind: "added", text: current[right++]! });
  }
  return output;
}

function findLine(lines: string[], target: string | undefined, start: number, window: number): number {
  if (target === undefined) return -1;
  const end = Math.min(lines.length, start + window);
  for (let index = start; index < end; index += 1) {
    if (lines[index] === target) return index;
  }
  return -1;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

import type {
  AiNovelTraceRequest,
  AiNovelTraceTurn,
} from "./types";

const STREAM_DELTA_TYPES = new Set([
  "content_delta",
  "reasoning_delta",
  "tool_call_delta",
]);

type JsonRecord = Record<string, unknown>;
const DUPLICATED_DIAGNOSTIC_KEYS = new Set([
  "content",
  "delta",
  "deltas",
  "events",
  "message",
  "messages",
  "raw",
  "reasoning",
  "reasoning_content",
  "text",
  "tool_calls",
]);
const DUPLICATED_REQUEST_KEYS = new Set([
  "completion",
  "contextUsage",
  "events",
  "messages",
  "piContextUsage",
]);

/**
 * Build the JSON representation shown by the admin trace view.
 *
 * Stream events are intentionally summarized here. The rendered view already
 * shows the assembled messages, while retaining every character-sized delta in
 * JSON makes a trace effectively impossible to inspect and duplicates nested
 * `raw` payloads. Non-stream events remain available for diagnosis.
 */
export function compactTraceTurnForJson(turn: AiNovelTraceTurn): JsonRecord {
  return {
    id: turn.id,
    index: turn.index,
    status: turn.status,
    capturedAt: turn.capturedAt,
    ...(turn.userMessage ? { userMessage: turn.userMessage } : {}),
    messages: turn.messages,
    requests: turn.requests.map(compactTraceRequestForJson),
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.transport ? { transport: turn.transport } : {}),
    ...(turn.tokenCount !== undefined ? { tokenCount: turn.tokenCount } : {}),
    ...(turn.contextUsage ? { contextUsage: turn.contextUsage } : {}),
    ...(turn.durationMs !== undefined ? { durationMs: turn.durationMs } : {}),
    toolNames: turn.toolNames,
    contextDiff: turn.contextDiff,
  };
}

export function compactTraceRequestForJson(request: AiNovelTraceRequest): JsonRecord {
  const raw = request.raw;
  const completion = compactCompletion(raw.completion);
  const context = isRecord(raw.context) ? raw.context : undefined;
  const rawMetadata = compactRequestMetadata(raw);
  return {
    id: request.id,
    index: request.index,
    ...(request.sceneKey ? { sceneKey: request.sceneKey } : {}),
    status: request.status,
    capturedAt: request.capturedAt,
    messages: request.messages,
    events: compactTraceEvents(request.events),
    ...(request.model ? { model: request.model } : {}),
    ...(request.transport ? { transport: request.transport } : {}),
    ...(request.tokenCount !== undefined ? { tokenCount: request.tokenCount } : {}),
    ...(request.contextUsage ? { contextUsage: request.contextUsage } : {}),
    ...(request.durationMs !== undefined ? { durationMs: request.durationMs } : {}),
    toolNames: request.toolNames,
    ...(completion ? { completion } : {}),
    raw: rawMetadata,
  };
}

function compactTraceEvents(events: JsonRecord[]): JsonRecord {
  const deltaSummary = new Map<string, { count: number; characters: number }>();
  const details: JsonRecord[] = [];
  for (const event of events) {
    const nestedRaw = isRecord(event.raw) ? event.raw : undefined;
    const type = typeof event.type === "string"
      ? event.type
      : typeof nestedRaw?.type === "string" ? nestedRaw.type : "unknown";
    if (isStreamDelta(type)) {
      const summary = deltaSummary.get(type) ?? { count: 0, characters: 0 };
      summary.count += 1;
      summary.characters += textLength(event.text ?? nestedRaw?.text);
      deltaSummary.set(type, summary);
      continue;
    }
    const detail: JsonRecord = { ...event };
    if (isRecord(event.raw)) {
      detail.raw = compactDiagnosticPayload(event.raw);
    }
    details.push(detail);
  }
  return {
    total: events.length,
    ...(deltaSummary.size > 0
      ? { deltaSummary: Object.fromEntries(deltaSummary.entries()) }
      : {}),
    ...(details.length > 0 ? { details } : {}),
  };
}

function compactCompletion(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { raw, ...completion } = value;
  return {
    ...completion,
    ...(raw !== undefined ? { raw: compactDiagnosticPayload(raw) } : {}),
  };
}

function compactRequestMetadata(raw: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([key]) => !DUPLICATED_REQUEST_KEYS.has(key))
      .map(([key, value]) => [key, compactDiagnosticPayload(value)]),
  );
}

function compactDiagnosticPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactDiagnosticPayload);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        const normalizedKey = key.toLowerCase();
        return !DUPLICATED_DIAGNOSTIC_KEYS.has(normalizedKey) &&
          !normalizedKey.endsWith("_delta");
      })
      .map(([key, nested]) => [key, compactDiagnosticPayload(nested)]),
  );
}

function isStreamDelta(type: string): boolean {
  return STREAM_DELTA_TYPES.has(type) || type.endsWith("_delta");
}

function textLength(value: unknown): number {
  return typeof value === "string" ? Array.from(value).length : 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import { ApplicationError } from "../shared/errors.ts";
import type {
  LLMStreamEvent,
  LLMUsage,
} from "./llm-manager.ts";
import type {
  OpenAICompatibleResponsePayload,
  StreamTimeoutOptions,
} from "./bailian-openai-compatible-types.ts";
import {
  buildFallbackToolCallId,
  readOptionalNonBlankString,
  readOptionalString,
  resolveStreamTimeouts,
  throwProviderRequestFailed,
  throwProviderResponseInvalid,
} from "./bailian-openai-compatible-utils.ts";

export interface BailianStreamContext {
  body: ReadableStream<Uint8Array>;
  responseStatus: number;
  modelKey: string;
  providerName?: string;
  parseChatUsage(usage: OpenAICompatibleResponsePayload["usage"]): LLMUsage | undefined;
  logRawChunk(chunk: string): void;
  streamOptions?: Record<string, unknown>;
}

export async function* parseBailianOpenAICompatibleStream(
  context: BailianStreamContext,
): AsyncIterable<LLMStreamEvent> {
  const streamTimeouts = resolveStreamTimeouts(context.streamOptions);
  let finishReason: string | undefined;
  const pendingToolCalls = new Map<
    number,
    { id?: string; name?: string; args: string; progressText?: string }
  >();

  for await (const eventData of readServerSentEvents(context.body, streamTimeouts, context.providerName)) {
    context.logRawChunk(eventData);
    if (eventData === "[DONE]") {
      yield {
        type: "done",
        finishReason,
      };
      return;
    }

    const payload = parseStreamPayload(eventData, context.providerName);
    if (payload.error) {
      throwProviderRequestFailed(context.responseStatus, payload, context.providerName);
    }

    const usage = context.parseChatUsage(payload.usage);
    if (usage) {
      yield {
        type: "usage",
        usage,
        rawEvent: eventData,
      };
    }

    const choice = payload.choices?.[0];
    if (!choice) {
      if (!usage) {
        throwProviderResponseInvalid(
          "Streaming chunk does not contain choices or usage.",
          undefined,
          context.providerName,
        );
      }
      continue;
    }

    const nextFinishReason = readOptionalString(choice.finish_reason);
    if (nextFinishReason) {
      finishReason = nextFinishReason;
    }

    yield* readStreamDeltaEvents({
      eventData,
      modelKey: context.modelKey,
      pendingToolCalls,
      nextFinishReason,
      payload,
    });
  }

  throwProviderResponseInvalid("Streaming response ended before [DONE].", undefined, context.providerName);
}

function parseStreamPayload(eventData: string, providerName?: string): OpenAICompatibleResponsePayload {
  try {
    return JSON.parse(eventData) as OpenAICompatibleResponsePayload;
  } catch (error) {
    throwProviderResponseInvalid(
      "Streaming chunk is not valid JSON.",
      {
        cause: error instanceof Error ? error.message : String(error),
        chunk: eventData,
      },
      providerName,
    );
  }
}

async function* readStreamDeltaEvents(input: {
  eventData: string;
  modelKey: string;
  pendingToolCalls: Map<number, { id?: string; name?: string; args: string; progressText?: string }>;
  nextFinishReason?: string;
  payload: OpenAICompatibleResponsePayload;
}): AsyncIterable<LLMStreamEvent> {
  const choice = input.payload.choices?.[0];
  if (!choice) {
    return;
  }

  for (const deltaToolCall of choice.delta?.tool_calls ?? []) {
    const event = readToolCallDeltaEvent(input.eventData, input.pendingToolCalls, deltaToolCall);
    if (event) {
      yield event;
    }
  }

  const reasoningDelta = readOptionalString(choice.delta?.reasoning) ??
    readOptionalString(choice.delta?.reasoning_content);
  if (reasoningDelta) {
    yield {
      type: "reasoning_delta",
      text: reasoningDelta,
      rawEvent: input.eventData,
    };
  }

  const contentDelta = readOptionalString(choice.delta?.content);
  if (contentDelta) {
    yield {
      type: "content_delta",
      text: contentDelta,
      rawEvent: input.eventData,
    };
  }

  if (input.nextFinishReason === "tool_calls" && input.pendingToolCalls.size > 0) {
    for (const [index, toolCall] of input.pendingToolCalls.entries()) {
      if (!toolCall.name) {
        continue;
      }
      yield {
        type: "tool_call",
        toolCall: {
          id: toolCall.id ?? buildFallbackToolCallId(input.modelKey, index),
          name: toolCall.name,
          input: parseToolArguments(toolCall.args),
        },
        rawEvent: input.eventData,
      };
    }
    input.pendingToolCalls.clear();
  }
}

function readToolCallDeltaEvent(
  eventData: string,
  pendingToolCalls: Map<number, { id?: string; name?: string; args: string; progressText?: string }>,
  deltaToolCall: NonNullable<NonNullable<OpenAICompatibleResponsePayload["choices"]>[number]["delta"]>["tool_calls"][number],
): LLMStreamEvent | undefined {
  const index = typeof deltaToolCall.index === "number" ? deltaToolCall.index : 0;
  const existing = pendingToolCalls.get(index) ?? { args: "" };
  const argumentDelta = deltaToolCall.function?.arguments ?? "";
  const nextName = readOptionalNonBlankString(deltaToolCall.function?.name) ?? existing.name;
  const nextId = readOptionalNonBlankString(deltaToolCall.id) ?? existing.id;
  const progressSpec = toolProgressSpec(nextName);
  const nextArgs = existing.args + argumentDelta;
  const nextProgressText = progressSpec?.path
    ? extractTopLevelJsonStringField(nextArgs, progressSpec.path)
    : undefined;
  const progressDelta = progressSpec?.path
    ? nextProgressText?.slice((existing.progressText ?? "").length)
    : progressSpec?.rawJsonProgress
      ? readableJsonProgressDelta(argumentDelta)
      : progressSpec?.known
        ? undefined
        : argumentDelta;
  pendingToolCalls.set(index, {
    id: nextId,
    name: nextName,
    args: nextArgs,
    progressText: nextProgressText ?? existing.progressText,
  });
  if (!progressDelta) {
    return undefined;
  }
  return {
    type: "tool_call_delta",
    text: progressDelta,
    toolCallId: nextId,
    toolCallName: nextName,
    toolArgumentPath: progressSpec?.path,
    rawEvent: eventData,
  };
}

function parseToolArguments(args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  options: StreamTimeoutOptions = {},
  providerName?: string,
): AsyncIterable<string> {
  const firstEventTimeoutMs = options.firstEventTimeoutMs ?? 0;
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let eventDataLines: string[] = [];
  let hasEvent = false;

  try {
    while (true) {
      const timeoutMs = hasEvent ? idleTimeoutMs : firstEventTimeoutMs;
      const result = await readStreamChunkWithTimeout(reader, timeoutMs, hasEvent, providerName);
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const parsed = readBufferedEventLines(buffer, eventDataLines);
      buffer = parsed.buffer;
      eventDataLines = parsed.eventDataLines;
      for (const event of parsed.events) {
        hasEvent = true;
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  const trailingEvent = readTrailingEvent(buffer, eventDataLines);
  if (trailingEvent) {
    yield trailingEvent;
  }
}

function readBufferedEventLines(
  buffer: string,
  eventDataLines: string[],
): { buffer: string; eventDataLines: string[]; events: string[] } {
  const events: string[] = [];
  let nextBuffer = buffer;
  const nextEventDataLines = [...eventDataLines];
  while (true) {
    const newlineIndex = nextBuffer.indexOf("\n");
    if (newlineIndex === -1) {
      break;
    }

    const rawLine = nextBuffer.slice(0, newlineIndex);
    nextBuffer = nextBuffer.slice(newlineIndex + 1);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (!line) {
      if (nextEventDataLines.length > 0) {
        events.push(nextEventDataLines.join("\n"));
        nextEventDataLines.length = 0;
      }
      continue;
    }

    if (line.startsWith("data:")) {
      nextEventDataLines.push(line.slice("data:".length).trimStart());
    }
  }
  return { buffer: nextBuffer, eventDataLines: nextEventDataLines, events };
}

function readTrailingEvent(buffer: string, eventDataLines: string[]): string | undefined {
  if (buffer) {
    const trailingLine = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
    if (trailingLine.startsWith("data:")) {
      eventDataLines.push(trailingLine.slice("data:".length).trimStart());
    }
  }
  return eventDataLines.length > 0 ? eventDataLines.join("\n") : undefined;
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  hasEvent: boolean,
  providerName?: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (timeoutMs <= 0) {
    return reader.read();
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => reject(streamTimeoutError(hasEvent, timeoutMs, providerName)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function streamTimeoutError(
  hasEvent: boolean,
  timeoutMs: number,
  providerName = "bailian",
): ApplicationError {
  return new ApplicationError(
    504,
    "LLM_PROVIDER_REQUEST_FAILED",
    hasEvent
      ? `${providerName} stream stalled before completion.`
      : `${providerName} stream did not produce an initial event in time.`,
    {
      provider: providerName,
      reason: hasEvent ? "stream_idle_timeout" : "stream_first_event_timeout",
      timeoutMs,
    },
  );
}

function toolProgressSpec(
  toolName: string | undefined,
): { known: true; path?: string; rawJsonProgress?: boolean } | undefined {
  switch (toolName) {
    case "write_draft":
      return { known: true, path: "content" };
    case "submit_next_chapter_brief":
      return { known: true, path: "brief" };
    case "submit_chapter_summary":
      return { known: true, path: "summary" };
    case "submit_chapter_review":
      return { known: true, path: "summary" };
    case "submit_snapshot":
    case "submit_rolling_snapshot":
      return { known: true, path: "snapshot" };
    case "submit_hot_handoff":
      return { known: true, path: "handoff" };
    case "submit_import_plan_update":
    case "submit_chapter_summaries":
      return { known: true, rawJsonProgress: true };
    default:
      return undefined;
  }
}

function readableJsonProgressDelta(argumentDelta: string): string | undefined {
  const cleaned = argumentDelta
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/[{}\[\]"\\,:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length > 180 ? `${cleaned.slice(0, 180)}...` : cleaned;
}

function extractTopLevelJsonStringField(
  jsonFragment: string,
  fieldName: string,
): string | undefined {
  const keyIndex = jsonFragment.indexOf(JSON.stringify(fieldName));
  if (keyIndex < 0) {
    return undefined;
  }

  let index = keyIndex + JSON.stringify(fieldName).length;
  while (/\s/.test(jsonFragment[index] ?? "")) {
    index += 1;
  }
  if (jsonFragment[index] !== ":") {
    return undefined;
  }
  index += 1;
  while (/\s/.test(jsonFragment[index] ?? "")) {
    index += 1;
  }
  if (jsonFragment[index] !== '"') {
    return undefined;
  }

  let value = "";
  index += 1;
  while (index < jsonFragment.length) {
    const char = jsonFragment[index];
    if (char === '"') {
      return value;
    }
    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }

    if (index + 1 >= jsonFragment.length) {
      return value;
    }
    const escapeChar = jsonFragment[index + 1];
    if (escapeChar === "u") {
      const code = jsonFragment.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) {
        return value;
      }
      value += String.fromCharCode(Number.parseInt(code, 16));
      index += 6;
      continue;
    }

    value += decodeJsonEscape(escapeChar);
    index += 2;
  }

  return value;
}

function decodeJsonEscape(char: string): string {
  switch (char) {
    case '"':
    case "\\":
    case "/":
      return char;
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    default:
      return "";
  }
}

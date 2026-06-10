import { ApplicationError } from "../../shared/errors.ts";
import type {
  LLMStreamEvent,
  LLMToolCall,
} from "../../services/llm-manager.ts";
import type {
  AiNovelChatStreamChunk,
  AiNovelUsagePayload,
} from "./ai-novel-llm.service.ts";
import type { AiNovelPromptProfile } from "./ai-novel-llm-prompts.ts";

interface CompletionStreamState {
  content: string;
  reasoningText: string;
  finishReason?: string;
  usage?: AiNovelUsagePayload;
}

export async function* adaptBasicAiNovelStream(input: {
  events: AsyncIterable<LLMStreamEvent>;
  sceneRouteKey: string;
}): AsyncIterable<AiNovelChatStreamChunk> {
  const state: CompletionStreamState = { content: "", reasoningText: "" };
  for await (const event of input.events) {
    switch (event.type) {
      case "reasoning_delta":
        state.reasoningText += event.text;
        yield { type: "reasoning_delta", text: event.text };
        break;
      case "content_delta":
        state.content += event.text;
        yield { type: "content_delta", text: event.text };
        break;
      case "usage":
        state.usage = event.usage;
        yield { type: "usage", usage: event.usage };
        break;
      case "done":
        state.finishReason = event.finishReason;
        yield buildDoneChunk(input.sceneRouteKey, state);
        break;
      case "tool_call_delta":
      case "tool_call":
        throw unsupportedLlmStreamEvent(event);
      default:
        throw unsupportedLlmStreamEvent(event);
    }
  }
}

export async function* adaptPromptedAiNovelStream(input: {
  events: AsyncIterable<LLMStreamEvent>;
  sceneRouteKey: string;
  profile: AiNovelPromptProfile;
  normalizeToolCall(toolCall: LLMToolCall, fallbackIndex: number): LLMToolCall;
}): AsyncIterable<AiNovelChatStreamChunk> {
  const state: CompletionStreamState = { content: "", reasoningText: "" };
  let fallbackToolCallIndex = 0;
  for await (const event of input.events) {
    switch (event.type) {
      case "reasoning_delta":
        state.reasoningText += event.text;
        yield { type: "reasoning_delta", text: event.text };
        break;
      case "content_delta":
        state.content += event.text;
        yield { type: "content_delta", text: event.text };
        break;
      case "tool_call_delta": {
        const progress = workflowProgressForToolDelta(input.profile, event);
        if (progress) {
          yield progress;
        }
        break;
      }
      case "tool_call":
        yield {
          type: "tool_call",
          toolCall: input.normalizeToolCall(event.toolCall, fallbackToolCallIndex),
        };
        fallbackToolCallIndex += 1;
        break;
      case "usage":
        state.usage = event.usage;
        yield { type: "usage", usage: event.usage };
        break;
      case "done":
        state.finishReason = event.finishReason;
        yield buildDoneChunk(input.sceneRouteKey, state);
        break;
      default:
        throw unsupportedLlmStreamEvent(event);
    }
  }
}

export async function* adaptKickoffAiNovelStream(input: {
  events: AsyncIterable<LLMStreamEvent>;
  sceneRouteKey: string;
  normalizeToolCall(toolCall: LLMToolCall, fallbackIndex: number): LLMToolCall;
}): AsyncIterable<AiNovelChatStreamChunk> {
  const state: CompletionStreamState = { content: "", reasoningText: "" };
  let fallbackToolCallIndex = 0;
  for await (const event of input.events) {
    switch (event.type) {
      case "reasoning_delta":
        state.reasoningText += event.text;
        yield { type: "reasoning_delta", text: event.text };
        break;
      case "content_delta":
        state.content += event.text;
        yield { type: "content_delta", text: event.text };
        break;
      case "usage":
        state.usage = event.usage;
        yield { type: "usage", usage: event.usage };
        break;
      case "tool_call_delta":
        break;
      case "tool_call":
        yield {
          type: "tool_call",
          toolCall: input.normalizeToolCall(event.toolCall, fallbackToolCallIndex),
        };
        fallbackToolCallIndex += 1;
        break;
      case "done":
        state.finishReason = event.finishReason;
        yield buildDoneChunk(input.sceneRouteKey, state);
        break;
      default:
        throw unsupportedLlmStreamEvent(event);
    }
  }
}

export function unsupportedLlmStreamEvent(event: LLMStreamEvent): ApplicationError {
  return new ApplicationError(
    502,
    "AI_UPSTREAM_RESPONSE_INVALID",
    "Unsupported LLM stream event type.",
    {
      reason: "unsupported_stream_event",
      eventType: String((event as { type?: unknown }).type ?? "unknown"),
    },
  );
}

function buildDoneChunk(
  sceneRouteKey: string,
  state: CompletionStreamState,
): AiNovelChatStreamChunk {
  return {
    type: "done",
    completion: {
      sceneRouteKey,
      content: state.content,
      ...(state.reasoningText ? { reasoningText: state.reasoningText } : {}),
      ...(state.finishReason ? { finishReason: state.finishReason } : {}),
    },
    ...(state.usage ? { usage: state.usage } : {}),
  };
}

function workflowProgressForToolDelta(
  profile: AiNovelPromptProfile,
  event: Extract<LLMStreamEvent, { type: "tool_call_delta" }>,
): AiNovelChatStreamChunk | undefined {
  const mapping = workflowProgressMapping(profile, event.toolCallName);
  if (!mapping) {
    return undefined;
  }
  const deltaText = readableWorkflowProgressDeltaText(event);
  if (!deltaText) {
    return undefined;
  }
  return {
    type: "action.workflow_progress",
    payload: {
      workflowKey: mapping.workflowKey,
      stepKey: mapping.stepKey,
      subStepKey: mapping.subStepKey,
      status: "running",
      deltaText,
      processedTokens: estimateWorkflowProgressTokens(deltaText),
    },
  };
}

function workflowProgressMapping(
  profile: AiNovelPromptProfile,
  toolName: string | undefined,
):
  | {
      workflowKey: string;
      stepKey: string;
      subStepKey: string;
    }
  | undefined {
  if (profile === "chapter_draft" && toolName === "write_draft") {
    return { workflowKey: "chapter_generation", stepKey: "draft", subStepKey: "write_draft" };
  }
  if (profile === "next_chapter_brief" && toolName === "submit_next_chapter_brief") {
    return { workflowKey: "chapter_advance", stepKey: "plan", subStepKey: "next_chapter_brief" };
  }
  if (profile === "chapter_draft_review" && toolName === "submit_chapter_review") {
    return { workflowKey: "chapter_generation", stepKey: "draft", subStepKey: "draft_review" };
  }
  if (profile === "chapter_summary" && toolName === "submit_chapter_summary") {
    return { workflowKey: "chapter_advance", stepKey: "plan", subStepKey: "chapter_summary" };
  }
  if (profile === "snapshot_generation" && toolName === "submit_snapshot") {
    return { workflowKey: "chapter_advance", stepKey: "plan", subStepKey: "snapshot_generation" };
  }
  return undefined;
}

function estimateWorkflowProgressTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  const cjkChars = [...trimmed].filter((char) =>
    /[\u3400-\u9fff\uf900-\ufaff]/u.test(char),
  ).length;
  const nonCjkChars = Math.max(0, trimmed.length - cjkChars);
  return Math.max(1, Math.ceil(cjkChars + nonCjkChars / 4));
}

function readableWorkflowProgressDeltaText(
  event: Extract<LLMStreamEvent, { type: "tool_call_delta" }>,
): string | undefined {
  const path = event.toolArgumentPath ?? workflowToolArgumentPath(event.toolCallName);
  if (!path) {
    return event.text;
  }
  if (event.toolArgumentPath) {
    return event.text.trim().length > 0 ? event.text : undefined;
  }

  const parsed = parseJsonObject(event.text);
  const parsedValue = parsed ? parsed[path] : undefined;
  if (typeof parsedValue === "string") {
    return parsedValue;
  }

  return extractTopLevelJsonStringField(event.text, path);
}

function workflowToolArgumentPath(toolName: string | undefined) {
  switch (toolName) {
    case "write_draft":
      return "content";
    case "submit_next_chapter_brief":
      return "brief";
    case "submit_chapter_summary":
    case "submit_chapter_review":
      return "summary";
    case "submit_snapshot":
      return "snapshot";
    default:
      return undefined;
  }
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function extractTopLevelJsonStringField(
  jsonFragment: string,
  fieldName: string,
): string | undefined {
  const propertyToken = JSON.stringify(fieldName);
  const keyIndex = jsonFragment.indexOf(propertyToken);
  if (keyIndex < 0) {
    return undefined;
  }

  let index = keyIndex + propertyToken.length;
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

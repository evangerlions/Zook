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
        yield toolCallDeltaChunk(event);
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
        yield toolCallDeltaChunk(event);
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

function toolCallDeltaChunk(
  event: Extract<LLMStreamEvent, { type: "tool_call_delta" }>,
): AiNovelChatStreamChunk {
  return {
    type: "tool_call_delta",
    text: event.text,
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(event.toolCallName ? { toolCallName: event.toolCallName } : {}),
    ...(event.toolArgumentPath ? { toolArgumentPath: event.toolArgumentPath } : {}),
  };
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

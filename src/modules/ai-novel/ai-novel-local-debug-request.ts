import type { LLMMessage } from "../../services/llm-manager.ts";
import type { AiNovelPromptProfile } from "./ai-novel-llm-prompts.ts";
import type {
  AiNovelChatStreamChunk,
  AiNovelLocalDebugLlmRequestPayload,
} from "./ai-novel-llm-types.ts";

export function buildLocalDebugLlmRequestPayload(input: {
  sceneKey: string;
  sceneRouteKey: string;
  messages: LLMMessage[];
  temperature: number;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
  profile?: AiNovelPromptProfile;
  stream: boolean;
}): AiNovelLocalDebugLlmRequestPayload {
  return {
    sceneKey: input.sceneKey,
    sceneRouteKey: input.sceneRouteKey,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    ...(input.profile ? { profile: input.profile } : {}),
    requestBody: {
      sceneRouteKey: input.sceneRouteKey,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      stream: input.stream,
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    },
  };
}

export function buildLocalDebugLlmRequestChunk(input: {
  sceneKey: string;
  sceneRouteKey: string;
  messages: LLMMessage[];
  temperature: number;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
  profile?: AiNovelPromptProfile;
}): AiNovelChatStreamChunk {
  return {
    type: "local_debug_llm_request",
    payload: buildLocalDebugLlmRequestPayload({
      ...input,
      stream: true,
    }),
  };
}

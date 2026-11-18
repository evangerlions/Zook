import type { ResolvedLLMCompletionRequest } from "./llm-manager.ts";
import type { LlmSmokeMatrixItem } from "./llm-smoke-test-target.ts";

const SMOKE_CHAT_MAX_TOKENS = 2048;
// The fixed English sample targets about 2,000 input tokens across common tokenizers.
const SMOKE_CONTEXT = Array.from({ length: 96 }, (_, index) =>
  `Scene ${index + 1}: The travelers review their plans, recall earlier events, and discuss their next steps.`,
).join("\n");
const SMOKE_MESSAGES = [
  {
    role: "system" as const,
    content: "You are a smoke test assistant. Follow the user's requested response length.",
  },
  {
    role: "user" as const,
    content: `${SMOKE_CONTEXT}\nWrite a coherent English summary of approximately 300 words.`,
  },
];

export type LlmSmokeChatRequest = Omit<ResolvedLLMCompletionRequest, "messages"> & {
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  maxTokens: number;
};

export function buildLlmSmokeChatRequest(item: LlmSmokeMatrixItem): LlmSmokeChatRequest {
  return {
    temperature: 0,
    maxTokens: SMOKE_CHAT_MAX_TOKENS,
    messages: SMOKE_MESSAGES,
    providerOptions: {},
    model: {
      provider: item.provider.key,
      adapterType: item.provider.type,
      modelKey: item.model.key,
      resolvedModelKey: item.model.key,
      providerModel: item.route.providerModel,
      ...(item.route.openRouter ? { openRouter: item.route.openRouter } : {}),
      providerConfig: {
        baseUrl: item.provider.baseUrl,
        apiKey: item.provider.apiKey,
        timeoutMs: item.provider.timeoutMs,
      },
    },
  };
}

import type { ResolvedLLMCompletionRequest } from "./llm-manager.ts";
import type { LlmSmokeMatrixItem } from "./llm-smoke-test-target.ts";

const SHORT_MESSAGES = [{ role: "user" as const, content: "Reply with OK only." }];
const REPRESENTATIVE_MAX_TOKENS = 32768;
// B.AI measured 9,845 input tokens for 47,900 context characters. Scale the
// representative probe to approximately 15k tokens; tokenizers vary between providers.
const REPRESENTATIVE_CONTEXT = Array.from({ length: 900 }, (_, index) =>
  `Scene ${index + 1}: The travelers review their plans, recall earlier events, and discuss their next steps.\n`,
).join("").slice(0, 72_900);
const REPRESENTATIVE_MESSAGES = [
  {
    role: "system" as const,
    content: "You are a smoke test assistant. Follow the user's requested response length.",
  },
  {
    role: "user" as const,
    content: `${REPRESENTATIVE_CONTEXT}\nWrite a coherent English summary of approximately 1,000 characters.`,
  },
];

export type LlmSmokeChatRequest = Omit<ResolvedLLMCompletionRequest, "messages"> & {
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature: number;
  maxTokens: number;
};

export function buildLlmSmokeChatRequest(
  item: LlmSmokeMatrixItem,
  probe: "short" | "representative",
): LlmSmokeChatRequest {
  return {
    temperature: 0,
    maxTokens: probe === "short" ? 64 : REPRESENTATIVE_MAX_TOKENS,
    messages: probe === "short" ? SHORT_MESSAGES : REPRESENTATIVE_MESSAGES,
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

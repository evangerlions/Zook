import type { CreateApplicationOptions } from "./application-options.ts";
import { ALIYUN_TOKEN_PLAN_PROVIDER_KEY } from "./services/aliyun-token-plan-provider.ts";
import { VOLCENGINE_AGENT_PLAN_PROVIDER_KEY } from "./services/volcengine-agent-plan-provider.ts";

const DEFAULT_CHAT_PROVIDER_KEYS = [
  "bailian",
  "bailian_coding",
  "openrouter",
  ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
  VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
];
const DEFAULT_EMBEDDING_PROVIDER_KEYS = [
  "bailian",
  "bailian_coding",
  "openrouter",
];

export function resolveRuntimeLlmProviderKeys(
  options: Pick<CreateApplicationOptions, "llmProviders" | "embeddingProviders">,
) {
  return {
    chat: new Set(
      Object.keys(options.llmProviders ?? toProviderRecord(DEFAULT_CHAT_PROVIDER_KEYS)),
    ),
    embedding: new Set(
      Object.keys(
        options.embeddingProviders ?? toProviderRecord(DEFAULT_EMBEDDING_PROVIDER_KEYS),
      ),
    ),
  };
}

function toProviderRecord(keys: string[]): Record<string, true> {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

/** Existing provider keys are also their historical adapter identifiers. */
export const LLM_PROVIDER_TYPES = [
  "bailian", "bailian_coding", "bai", "openrouter",
  "bailian_token_plan", "volcengine_agent_plan", "volcengine",
] as const;

export type LlmProviderType = typeof LLM_PROVIDER_TYPES[number];

export function resolveLlmProviderType(key: string, type?: unknown): string | undefined {
  if (type === undefined) return LLM_PROVIDER_TYPES.find((item) => item === key);
  const candidate = type;
  if (typeof candidate !== "string" || !LLM_PROVIDER_TYPES.some((item) => item === candidate)) {
    throw new Error(`Unsupported LLM provider type for ${key}: ${String(candidate)}`);
  }
  return candidate;
}

import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";
import type { ResolvedLLMCompletionRequest } from "./llm-manager.ts";

export const VOLCENGINE_PROVIDER_KEY = "volcengine";
export const DEFAULT_VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

/** Ark pay-as-you-go; intentionally separate from the Agent Plan endpoint. */
export class VolcengineProvider extends BailianOpenAICompatibleProvider {
  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    super({ ...options, providerName: VOLCENGINE_PROVIDER_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_VOLCENGINE_BASE_URL,
      apiKey: options.apiKey ?? "" });
  }

  override complete(request: ResolvedLLMCompletionRequest) {
    return super.complete(arkRequest(request));
  }

  override stream(request: ResolvedLLMCompletionRequest) {
    return super.stream(arkRequest(request));
  }
}

function arkRequest(request: ResolvedLLMCompletionRequest): ResolvedLLMCompletionRequest {
  const { enable_thinking, ...options } = request.providerOptions ?? {};
  return { ...request, providerOptions: {
    ...options,
    ...(options.thinking === undefined && typeof enable_thinking === "boolean"
      ? { thinking: { type: enable_thinking ? "enabled" : "disabled" } } : {}),
  } };
}

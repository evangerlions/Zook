import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";
import { withTypedThinking } from "./bailian-openai-compatible-utils.ts";
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
    return super.complete(withTypedThinking(request));
  }

  override stream(request: ResolvedLLMCompletionRequest) {
    return super.stream(withTypedThinking(request));
  }
}

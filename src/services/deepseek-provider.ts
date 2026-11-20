import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";
import { withTypedThinking } from "./bailian-openai-compatible-utils.ts";
import type { ResolvedLLMCompletionRequest } from "./llm-manager-types.ts";

export const DEEPSEEK_PROVIDER_KEY = "deepseek";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export class DeepSeekProvider extends BailianOpenAICompatibleProvider {
  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    super({
      ...options,
      providerName: DEEPSEEK_PROVIDER_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL,
      apiKey: options.apiKey ?? "",
    });
  }

  override complete(request: ResolvedLLMCompletionRequest) {
    return super.complete(withTypedThinking(request));
  }

  override stream(request: ResolvedLLMCompletionRequest) {
    return super.stream(withTypedThinking(request));
  }
}

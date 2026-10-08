import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";
import type { ResolvedLLMCompletionRequest } from "./llm-manager.ts";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterOpenAICompatibleProvider extends BailianOpenAICompatibleProvider {
  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    super({
      ...options,
      providerName: "openrouter",
      baseUrl:
        options.baseUrl ??
        process.env.OPENROUTER_BASE_URL ??
        DEFAULT_OPENROUTER_BASE_URL,
      apiKey:
        options.apiKey ??
        process.env.OPENROUTER_API_KEY ??
        process.env.OPENROUTER_KEY ??
        "",
    });
  }

  override async complete(request: ResolvedLLMCompletionRequest) {
    return await super.complete(this.applyRoutingConfig(request));
  }

  override async *stream(request: ResolvedLLMCompletionRequest) {
    yield* super.stream(this.applyRoutingConfig(request));
  }

  private applyRoutingConfig(
    request: ResolvedLLMCompletionRequest,
  ): ResolvedLLMCompletionRequest {
    const config = request.model.openRouter;
    if (!config) return request;

    return {
      ...request,
      providerOptions: {
        ...request.providerOptions,
        provider: structuredClone(config.provider),
      },
    };
  }
}

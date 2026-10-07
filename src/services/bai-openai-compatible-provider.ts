import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";
import type { ResolvedLLMCompletionRequest } from "./llm-manager.ts";

export const BAI_PROVIDER_KEY = "bai";
export const DEFAULT_BAI_BASE_URL = "https://api.b.ai/v1";
export const BAI_GLM_5_3_FLASH_MODEL = "glm-5.3-flash";
export const BAI_MINIMAX_M3_MODEL = "minimax-m3";

/**
 * B.AI's GLM-5.3-Flash keeps reasoning enabled and defaults it to `max`.
 * Its low-effort mode preserves room for visible text in ordinary chat calls.
 */
export class BaiOpenAICompatibleProvider extends BailianOpenAICompatibleProvider {
  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    super({
      ...options,
      providerName: BAI_PROVIDER_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_BAI_BASE_URL,
      apiKey: options.apiKey ?? "",
    });
  }

  override async complete(request: ResolvedLLMCompletionRequest) {
    return await super.complete(this.applyModelDefaults(request));
  }

  override async *stream(request: ResolvedLLMCompletionRequest) {
    yield* super.stream(this.applyModelDefaults(request));
  }

  private applyModelDefaults(
    request: ResolvedLLMCompletionRequest,
  ): ResolvedLLMCompletionRequest {
    const providerOptions = request.providerOptions;
    const needsGlmReasoningEffort =
      request.model.providerModel === BAI_GLM_5_3_FLASH_MODEL &&
      providerOptions?.reasoning_effort === undefined;
    const needsMinimaxReasoningSplit =
      request.model.providerModel === BAI_MINIMAX_M3_MODEL &&
      providerOptions?.reasoning_split === undefined;

    if (!needsGlmReasoningEffort && !needsMinimaxReasoningSplit) {
      return request;
    }

    return {
      ...request,
      providerOptions: {
        ...providerOptions,
        ...(needsGlmReasoningEffort ? { reasoning_effort: "low" } : {}),
        ...(needsMinimaxReasoningSplit ? { reasoning_split: true } : {}),
      },
    };
  }
}

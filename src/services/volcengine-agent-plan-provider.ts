import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";
import type { ResolvedLLMCompletionRequest } from "./llm-manager.ts";

export const VOLCENGINE_AGENT_PLAN_PROVIDER_KEY = "volcengine_agent_plan";
export const DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/plan/v3";

export class VolcengineAgentPlanProvider extends BailianOpenAICompatibleProvider {
  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    super({
      ...options,
      providerName: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL,
      apiKey: options.apiKey ?? "",
    });
  }

  protected override buildChatRequestBody(
    request: ResolvedLLMCompletionRequest,
  ): Record<string, unknown> {
    if (request.model.providerModel === "kimi-k3.1-pro") {
      return super.buildChatRequestBody({ ...request, temperature: 1 });
    }
    return super.buildChatRequestBody(request);
  }
}

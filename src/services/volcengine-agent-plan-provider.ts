import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";

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
}

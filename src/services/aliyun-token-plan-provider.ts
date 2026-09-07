import { BailianOpenAICompatibleProvider } from "./bailian-openai-compatible-provider.ts";
import type { BailianOpenAICompatibleProviderOptions } from "./bailian-openai-compatible-types.ts";

export const ALIYUN_TOKEN_PLAN_PROVIDER_KEY = "bailian_token_plan";
export const DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL =
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

export class AliyunTokenPlanProvider extends BailianOpenAICompatibleProvider {
  constructor(options: BailianOpenAICompatibleProviderOptions = {}) {
    super({
      ...options,
      providerName: ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL,
      apiKey: options.apiKey ?? "",
    });
  }
}

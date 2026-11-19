import { addCatalogModels } from "./llm-model-catalog.ts";
import type { LlmModelConfig, LlmServiceConfig } from "../shared/types.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import {
  ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
  DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL,
} from "./aliyun-token-plan-provider.ts";

export const ALIYUN_TOKEN_PLAN_PASSWORD_KEY = "bailian.token_plan_api_key";
export const ALIYUN_TOKEN_PLAN_API_KEY_REFERENCE =
  `{{zook.ps.${ALIYUN_TOKEN_PLAN_PASSWORD_KEY}}}`;

interface AliyunTokenPlanChatModel {
  key: string;
  label: string;
  providerModel: string;
}

export const ALIYUN_TOKEN_PLAN_CHAT_MODELS = [
  tokenPlanModel("qwen3.8-max", "Qwen 3.8 Max"),
  tokenPlanModel("qwen3.8-flash", "Qwen 3.8 Flash"),
  tokenPlanModel("qwen3.7-plus", "Qwen 3.7 Plus"),
  tokenPlanModel("qwen3.7-max", "Qwen 3.7 Max"),
  tokenPlanModel("qwen3.6-flash", "Qwen 3.6 Flash"),
  tokenPlanModel("deepseek-v4-pro", "DeepSeek V4 Pro"),
  tokenPlanModel("deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek-v4-flash-0731"),
  tokenPlanModel("glm-5.2", "GLM 5.2"),
  tokenPlanModel("glm-5.3", "GLM 5.3"),
] as const satisfies readonly AliyunTokenPlanChatModel[];

export async function importAliyunTokenPlanConfig(
  llmConfigService: CommonLlmConfigService,
  passwordConfigService: CommonPasswordConfigService,
): Promise<boolean> {
  const passwordExists = Boolean(
    await passwordConfigService.getValue(ALIYUN_TOKEN_PLAN_PASSWORD_KEY),
  );
  if (!passwordExists) {
    return false;
  }

  const current = await llmConfigService.getCurrentConfig();
  const imported = addAliyunTokenPlanConfig(current);
  if (!imported) {
    return false;
  }

  await llmConfigService.updateConfig(
    imported,
    "import Aliyun Bailian Token Plan from PASSWORDS",
  );
  return true;
}

export function addAliyunTokenPlanConfig(
  current: LlmServiceConfig,
): LlmServiceConfig | undefined {
  const hasProvider = current.providers.some(
    (provider) => provider.key === ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
  );
  if (hasProvider) return undefined;

  return {
    ...current,
    providers: [
      ...current.providers,
      {
        key: ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
        label: "Aliyun Bailian Token Plan",
        enabled: true,
        baseUrl: DEFAULT_ALIYUN_TOKEN_PLAN_BASE_URL,
        apiKey: ALIYUN_TOKEN_PLAN_API_KEY_REFERENCE,
        timeoutMs: 60_000,
      },
    ],
    models: addCatalogModels(current.models, ALIYUN_TOKEN_PLAN_CHAT_MODELS.map(createTokenPlanModelConfig)),
  };
}

function tokenPlanModel(
  key: string,
  label: string,
  providerModel = key,
): AliyunTokenPlanChatModel {
  return {
    key,
    label,
    providerModel,
  };
}

function createTokenPlanModelConfig(
  model: AliyunTokenPlanChatModel,
): LlmModelConfig {
  return {
    key: model.key,
    label: model.label,
    kind: "chat",
    strategy: "fixed",
    routes: [
      {
        provider: ALIYUN_TOKEN_PLAN_PROVIDER_KEY,
        providerModel: model.providerModel,
        enabled: true,
        weight: 100,
      },
    ],
  };
}

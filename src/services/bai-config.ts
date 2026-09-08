import type { LlmServiceConfig } from "../shared/types.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import {
  BAI_GLM_5_3_FLASH_MODEL,
  BAI_PROVIDER_KEY,
  DEFAULT_BAI_BASE_URL,
} from "./bai-openai-compatible-provider.ts";

export const BAI_API_KEY_PASSWORD_KEY = "bai.api_key";
export const BAI_API_KEY_REFERENCE = `{{zook.ps.${BAI_API_KEY_PASSWORD_KEY}}}`;
export const BAI_GLM_5_3_FLASH_MODEL_KEY = "bai-glm-5.3-flash";

export async function importBaiConfig(
  llmConfigService: CommonLlmConfigService,
  passwordConfigService: CommonPasswordConfigService,
): Promise<boolean> {
  if (!await passwordConfigService.getValue(BAI_API_KEY_PASSWORD_KEY)) {
    return false;
  }

  const imported = addBaiConfig(await llmConfigService.getCurrentConfig());
  if (!imported) {
    return false;
  }

  await llmConfigService.updateConfig(imported, "import B.AI from PASSWORDS");
  return true;
}

export function addBaiConfig(
  current: LlmServiceConfig,
): LlmServiceConfig | undefined {
  const hasProvider = current.providers.some(
    (provider) => provider.key === BAI_PROVIDER_KEY,
  );
  const hasModel = current.models.some(
    (model) => model.key === BAI_GLM_5_3_FLASH_MODEL_KEY,
  );
  if (hasProvider && hasModel) {
    return undefined;
  }

  return {
    ...current,
    providers: hasProvider
      ? current.providers
      : [
          ...current.providers,
          {
            key: BAI_PROVIDER_KEY,
            label: "B.AI",
            enabled: true,
            baseUrl: DEFAULT_BAI_BASE_URL,
            apiKey: BAI_API_KEY_REFERENCE,
            timeoutMs: 60_000,
          },
        ],
    models: hasModel
      ? current.models
      : [
          ...current.models,
          {
            key: BAI_GLM_5_3_FLASH_MODEL_KEY,
            label: "B.AI GLM-5.3-Flash",
            kind: "chat",
            strategy: "fixed",
            routes: [
              {
                provider: BAI_PROVIDER_KEY,
                providerModel: BAI_GLM_5_3_FLASH_MODEL,
                enabled: true,
                weight: 100,
              },
            ],
          },
        ],
  };
}

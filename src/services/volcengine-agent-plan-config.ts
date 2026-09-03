import type { LlmServiceConfig } from "../shared/types.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "./common-password-config.service.ts";
import {
  DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL,
  VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
} from "./volcengine-agent-plan-provider.ts";

export const VOLCENGINE_AGENT_PLAN_PASSWORD_KEY = "vol.agent_plan_api_key";
export const VOLCENGINE_AGENT_PLAN_API_KEY_REFERENCE =
  `{{zook.ps.${VOLCENGINE_AGENT_PLAN_PASSWORD_KEY}}}`;
export const VOLCENGINE_AGENT_PLAN_MODEL_KEY = "doubao-seed-2.0-pro";

export async function importVolcengineAgentPlanConfig(
  llmConfigService: CommonLlmConfigService,
  passwordConfigService: CommonPasswordConfigService,
): Promise<boolean> {
  const passwordExists = Boolean(
    await passwordConfigService.getValue(VOLCENGINE_AGENT_PLAN_PASSWORD_KEY),
  );
  if (!passwordExists) {
    return false;
  }

  const current = await llmConfigService.getCurrentConfig();
  const imported = addVolcengineAgentPlanConfig(current);
  if (!imported) {
    return false;
  }

  await llmConfigService.updateConfig(
    imported,
    "import Volcengine Ark Agent Plan from PASSWORDS",
  );
  return true;
}

export function addVolcengineAgentPlanConfig(
  current: LlmServiceConfig,
): LlmServiceConfig | undefined {
  const hasProvider = current.providers.some(
    (provider) => provider.key === VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
  );
  const hasModel = current.models.some(
    (model) => model.key === VOLCENGINE_AGENT_PLAN_MODEL_KEY,
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
            key: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
            label: "Volcengine Ark Agent Plan",
            enabled: true,
            baseUrl: DEFAULT_VOLCENGINE_AGENT_PLAN_BASE_URL,
            apiKey: VOLCENGINE_AGENT_PLAN_API_KEY_REFERENCE,
            timeoutMs: 30_000,
          },
        ],
    models: hasModel
      ? current.models
      : [
          ...current.models,
          {
            key: VOLCENGINE_AGENT_PLAN_MODEL_KEY,
            label: "Doubao Seed 2.0 Pro",
            kind: "chat",
            strategy: "fixed",
            routes: [
              {
                provider: VOLCENGINE_AGENT_PLAN_PROVIDER_KEY,
                providerModel: VOLCENGINE_AGENT_PLAN_MODEL_KEY,
                enabled: true,
                weight: 100,
              },
            ],
          },
        ],
  };
}

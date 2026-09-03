import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminLlmSmokeTestRunRequest,
  AdminLlmSmokeTestTarget,
  LlmModelConfig,
  LlmProviderConfig,
  LlmServiceConfig,
} from "../shared/types.ts";

export interface LlmSmokeMatrixItem {
  model: LlmModelConfig;
  provider: LlmProviderConfig;
  route: LlmServiceConfig["models"][number]["routes"][number];
}

export function resolveLlmSmokeTestTarget(
  input: AdminLlmSmokeTestRunRequest | undefined,
): AdminLlmSmokeTestTarget {
  if (input?.mode !== "route") {
    return { mode: "matrix" };
  }

  return {
    mode: "route",
    modelKey: input.modelKey?.trim(),
    provider: input.provider?.trim(),
  };
}

export function buildLlmSmokeTestMatrix(
  config: LlmServiceConfig,
  target: AdminLlmSmokeTestTarget,
): LlmSmokeMatrixItem[] {
  if (target.mode === "matrix") {
    const providers = new Map(
      config.providers.map((provider) => [provider.key, provider]),
    );
    return config.models.flatMap((model) =>
      model.routes.flatMap((route) => {
        const provider = providers.get(route.provider);
        return route.enabled && provider?.enabled
          ? [{ model, provider, route }]
          : [];
      }),
    );
  }

  const model = config.models.find((item) => item.key === target.modelKey);
  const provider = config.providers.find((item) => item.key === target.provider);
  if (!model || !provider) {
    throwInvalidSmokeTarget(target, "目标模型或供应商不存在于当前生效配置。");
  }

  const route = model.routes.find((item) => item.provider === provider.key);
  if (!route) {
    throwInvalidSmokeTarget(target, "目标模型没有配置该供应商 route。");
  }
  if (!provider.enabled || !route.enabled) {
    throwInvalidSmokeTarget(target, "目标模型 route 当前未启用，不能发起冒烟请求。");
  }

  return [{
    model,
    provider,
    route,
  }];
}

function throwInvalidSmokeTarget(
  target: AdminLlmSmokeTestTarget,
  message: string,
): never {
  throw new ApplicationError(
    400,
    "ADMIN_LLM_SERVICE_INVALID",
    message,
    target,
  );
}

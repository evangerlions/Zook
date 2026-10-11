import { normalizeOpenRouterRouteConfig } from "../../../../src/shared/openrouter-route-config.ts";
const WEIGHT_PRECISION = 100;

export function normalizeRoutes(value: unknown, modelKey: string, providerKeys: Set<string>) {
  if (!Array.isArray(value)) {
    throw new Error(`模型 ${modelKey} 的 routes 必须是数组。`);
  }

  if (!value.length) {
    throw new Error(`模型 ${modelKey} 至少要有一条 route。`);
  }

  const routes = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`模型 ${modelKey} 的第 ${index + 1} 条 route 必须是 JSON object。`);
    }

    const source = item as Record<string, unknown>;
    const provider = normalizeProviderKey(source.provider);
    const providerModel = requireTrimmedString(
      source.providerModel,
      `模型 ${modelKey} 的第 ${index + 1} 条 route 必须填写 providerModel。`,
    );
    const enabled = Boolean(source.enabled);
    const weight = normalizeWeight(source.weight, modelKey, index + 1);

    if (!providerKeys.has(provider)) {
      throw new Error(`模型 ${modelKey} 的第 ${index + 1} 条 route 引用了不存在的供应商 ${provider}。`);
    }

    return {
      provider,
      providerModel,
      enabled,
      weight,
      ...normalizeRoutePolicy(source.openRouter, provider),
    };
  });

  const enabledRoutes = routes.filter((item) => item.enabled);
  if (enabledRoutes.length) {
    const totalWeight = enabledRoutes.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      throw new Error(`模型 ${modelKey} 当前启用 route 的 weight 合计必须等于 100。`);
    }
  }

  return routes;
}

function normalizeWeight(value: unknown, modelKey: string, routeIndex: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`模型 ${modelKey} 的第 ${routeIndex} 条 route weight 必须是 number。`);
  }

  if (value <= 0) {
    throw new Error(`模型 ${modelKey} 的第 ${routeIndex} 条 route weight 必须大于 0。`);
  }

  const normalized = Math.round(value * WEIGHT_PRECISION) / WEIGHT_PRECISION;
  if (Math.abs(value - normalized) > 0.000001) {
    throw new Error(`模型 ${modelKey} 的第 ${routeIndex} 条 route weight 最多保留两位小数。`);
  }

  return normalized;
}


function normalizeRoutePolicy(value: unknown, provider: string) {
  const config = normalizeOpenRouterRouteConfig(value, provider);
  return config ? { openRouter: config } : {};
}
function requireTrimmedString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}
function normalizeProviderKey(value: unknown): string {
  const key = requireTrimmedString(value, "Provider key is required.");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) throw new Error(`Provider key is invalid: ${key}`);
  return key;
}

export function parseOpenRouterRouteText(text: string | undefined) {
  if (!text?.trim()) return undefined;
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("OpenRouter 上游路由必须是合法 JSON。"); }
  return value;
}

export function updateLlmRouteDraft(
  route: import("./types").LlmRouteDraft,
  key: keyof import("./types").LlmRouteDraft,
  value: string | boolean,
): import("./types").LlmRouteDraft {
  return {
    ...route,
    [key]: value,
    ...(key === "provider" && value !== "openrouter" ? { openRouterText: "" } : {}),
  };
}

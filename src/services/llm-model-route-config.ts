import { badRequest } from "../shared/errors.ts";
import type { LlmModelRouteConfig } from "../shared/types.ts";
import { normalizeOpenRouterRouteConfig } from "../shared/openrouter-route-config.ts";
const WEIGHT_PRECISION = 100;

export function normalizeLlmModelRoutes(
  value: unknown,
  modelKey: string,
  providerKeys: Set<string>,
): LlmModelRouteConfig[] {
  if (!Array.isArray(value)) {
    badRequest("ADMIN_LLM_SERVICE_INVALID", `Model ${modelKey} routes must be an array.`);
  }

  if (!value.length) {
    badRequest("ADMIN_LLM_SERVICE_INVALID", `Model ${modelKey} must contain at least one route.`);
  }

  const routes = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Model ${modelKey} route #${index + 1} must be a JSON object.`);
    }

    const source = item as Record<string, unknown>;
    const provider = normalizeProviderKey(source.provider);
    const providerModel = requireTrimmedString(
      source.providerModel,
      `Model ${modelKey} route #${index + 1} providerModel is required.`,
    );
    const enabled = Boolean(source.enabled);
    const weight = normalizeWeight(source.weight, modelKey, index + 1);

    if (!providerKeys.has(provider)) {
      badRequest(
        "ADMIN_LLM_SERVICE_INVALID",
        `Model ${modelKey} route #${index + 1} references unknown provider ${provider}.`,
      );
    }

    return {
      provider,
      providerModel,
      enabled,
      weight,
      ...(normalizeRoutePolicy(source.openRouter, provider)),
    } satisfies LlmModelRouteConfig;
  });

  const enabledRoutes = routes.filter((item) => item.enabled);
  if (enabledRoutes.length) {
    const totalWeight = enabledRoutes.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      badRequest(
        "ADMIN_LLM_SERVICE_INVALID",
        `Enabled routes of model ${modelKey} must add up to 100, received ${totalWeight.toFixed(2)}.`,
      );
    }
  }

  return routes;
}

function normalizeWeight(value: unknown, modelKey: string, routeIndex: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      `Model ${modelKey} route #${routeIndex} weight must be a number.`,
    );
  }

  if (value <= 0) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      `Model ${modelKey} route #${routeIndex} weight must be greater than 0.`,
    );
  }

  const normalized = Math.round(value * WEIGHT_PRECISION) / WEIGHT_PRECISION;
  if (Math.abs(value - normalized) > 0.000001) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      `Model ${modelKey} route #${routeIndex} weight must keep at most 2 decimals.`,
    );
  }

  return normalized;
}


function normalizeRoutePolicy(value: unknown, provider: string) {
  try {
    const config = normalizeOpenRouterRouteConfig(value, provider);
    return config ? { openRouter: config } : {};
  } catch (error) {
    badRequest("ADMIN_LLM_SERVICE_INVALID", error instanceof Error ? error.message : "Invalid OpenRouter route config.");
  }
}
function requireTrimmedString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) badRequest("ADMIN_LLM_SERVICE_INVALID", message);
  return value.trim();
}
function normalizeProviderKey(value: unknown): string {
  const key = requireTrimmedString(value, "Provider key is required.");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) badRequest("ADMIN_LLM_SERVICE_INVALID", `Provider key is invalid: ${key}`);
  return key;
}

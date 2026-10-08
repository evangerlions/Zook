/** OpenRouter-only upstream routing preferences, in OpenRouter native field names. */
export interface OpenRouterProviderRouting {
  order?: string[];
  only?: string[];
  ignore?: string[];
  allow_fallbacks?: boolean;
  sort?: "price" | "throughput" | "latency";
  max_price?: { prompt?: number; completion?: number };
}

export interface OpenRouterRouteConfig {
  provider: OpenRouterProviderRouting;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} 必须是 JSON object。`);
  }
  return value as Record<string, unknown>;
}

function checkKeys(source: Record<string, unknown>, allowed: string[], name: string) {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new Error(`${name} 不支持字段 ${key}。`);
  }
}

export function normalizeOpenRouterRouteConfig(
  value: unknown,
  routeProvider: string,
): OpenRouterRouteConfig | undefined {
  if (value === undefined) return undefined;
  if (routeProvider !== "openrouter") throw new Error("openRouter 仅允许用于 OpenRouter route。");
  const source = object(value, "openRouter");
  checkKeys(source, ["provider"], "openRouter");
  const input = object(source.provider, "openRouter.provider");
  checkKeys(input, ["order", "only", "ignore", "allow_fallbacks", "sort", "max_price"], "openRouter.provider");
  const provider: OpenRouterProviderRouting = {};
  for (const key of ["order", "only", "ignore"] as const) {
    if (input[key] === undefined) continue;
    const entries = input[key];
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !/^[a-z0-9][a-z0-9_./-]*$/.test(entry))) {
      throw new Error(`openRouter.provider.${key} 必须是供应商 slug 数组。`);
    }
    if (new Set(entries).size !== entries.length) throw new Error(`openRouter.provider.${key} 不允许重复项。`);
    provider[key] = [...entries];
  }
  if (input.allow_fallbacks !== undefined) {
    if (typeof input.allow_fallbacks !== "boolean") throw new Error("allow_fallbacks 必须是 boolean。");
    provider.allow_fallbacks = input.allow_fallbacks;
  }
  if (input.sort !== undefined) {
    if (input.sort !== "price" && input.sort !== "throughput" && input.sort !== "latency") {
      throw new Error("sort 必须为 price、throughput 或 latency。");
    }
    provider.sort = input.sort;
  }
  if (input.max_price !== undefined) {
    const prices = object(input.max_price, "max_price");
    checkKeys(prices, ["prompt", "completion"], "max_price");
    provider.max_price = {};
    for (const key of ["prompt", "completion"] as const) {
      if (prices[key] === undefined) continue;
      const price = prices[key];
      if (typeof price !== "number" || !Number.isFinite(price) || price < 0) throw new Error(`max_price.${key} 必须是非负数（USD / 百万 tokens）。`);
      provider.max_price[key] = price;
    }
  }
  return { provider };
}

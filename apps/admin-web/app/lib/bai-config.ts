import type { BaiConfig } from "./types";

const DEFAULT_HMAC_SECRET_KEY = "bai.proxy.hmac_secret";

export function createDefaultBaiConfig(): BaiConfig {
  return {
    useTransparentProxy: false,
    transparentProxyBaseUrl: "",
    transparentProxyKeyId: "",
    transparentProxyHmacSecretKey: DEFAULT_HMAC_SECRET_KEY,
  };
}

export function normalizeBaiConfigInput(value: unknown): BaiConfig {
  const defaults = createDefaultBaiConfig();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  return {
    useTransparentProxy: Boolean(source.useTransparentProxy),
    transparentProxyBaseUrl: String(source.transparentProxyBaseUrl ?? defaults.transparentProxyBaseUrl).trim().replace(/\/+$/, ""),
    transparentProxyKeyId: String(source.transparentProxyKeyId ?? "").trim(),
    transparentProxyHmacSecretKey: String(source.transparentProxyHmacSecretKey ?? defaults.transparentProxyHmacSecretKey).trim() || defaults.transparentProxyHmacSecretKey,
  };
}

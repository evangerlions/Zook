import { badRequest } from "../shared/errors.ts";
import type { OpenRouterConfig } from "../shared/types.ts";

const DEFAULT_PROXY_BASE_URL = "https://oa.zimozone.com";
const DEFAULT_PROXY_HMAC_SECRET_KEY = "openrouter.proxy.hmac_secret";
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const PASSWORD_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function createDefaultOpenRouterConfig(): OpenRouterConfig {
  return {
    useTransparentProxy: false,
    transparentProxyBaseUrl: DEFAULT_PROXY_BASE_URL,
    transparentProxyKeyId: "",
    transparentProxyHmacSecretKey: DEFAULT_PROXY_HMAC_SECRET_KEY,
  };
}

export function normalizeOpenRouterConfig(value: unknown): OpenRouterConfig {
  const defaults = createDefaultOpenRouterConfig();
  if (value === undefined || value === null) {
    return defaults;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    badRequest("ADMIN_LLM_SERVICE_INVALID", "openRouter must be a JSON object.");
  }

  const source = value as Record<string, unknown>;
  const config: OpenRouterConfig = {
    useTransparentProxy: Boolean(source.useTransparentProxy),
    transparentProxyBaseUrl: normalizeProxyBaseUrl(
      source.transparentProxyBaseUrl ?? defaults.transparentProxyBaseUrl,
    ),
    transparentProxyKeyId: optionalString(source.transparentProxyKeyId),
    transparentProxyHmacSecretKey:
      optionalString(source.transparentProxyHmacSecretKey) ||
      defaults.transparentProxyHmacSecretKey,
  };

  if (
    config.transparentProxyKeyId &&
    !KEY_ID_PATTERN.test(config.transparentProxyKeyId)
  ) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      "OpenRouter transparent proxy key id is invalid.",
    );
  }
  if (!PASSWORD_KEY_PATTERN.test(config.transparentProxyHmacSecretKey)) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      "OpenRouter transparent proxy HMAC secret key is invalid.",
    );
  }
  if (config.useTransparentProxy && !config.transparentProxyKeyId) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      "OpenRouter transparent proxy key id is required when enabled.",
    );
  }

  return config;
}

function normalizeProxyBaseUrl(value: unknown): string {
  const normalized = optionalString(value).replace(/\/+$/, "");
  if (!normalized) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      "OpenRouter transparent proxy base URL is required.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      "OpenRouter transparent proxy base URL is invalid.",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    badRequest(
      "ADMIN_LLM_SERVICE_INVALID",
      "OpenRouter transparent proxy base URL must be an HTTPS URL without credentials, query, or fragment.",
    );
  }
  return normalized;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

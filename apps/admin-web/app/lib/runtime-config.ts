import type { RuntimeConfig } from "./types";

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  brandName: "Zook Control Room",
  defaultAppId: "",
  healthPath: "/api/health",
  analyticsUrl: "https://analytics.youwoai.net",
  logsUrl: "https://logs.youwoai.net/",
};

declare global {
  interface Window {
    __ADMIN_RUNTIME_CONFIG__?: Partial<RuntimeConfig>;
  }
}

function readEnvFallback(): Partial<RuntimeConfig> {
  const result: Partial<RuntimeConfig> = {};
  if (import.meta.env.VITE_ADMIN_BRAND_NAME) {
    result.brandName = import.meta.env.VITE_ADMIN_BRAND_NAME;
  }
  if (import.meta.env.VITE_ADMIN_DEFAULT_APP_ID) {
    result.defaultAppId = import.meta.env.VITE_ADMIN_DEFAULT_APP_ID;
  }
  if (import.meta.env.VITE_ADMIN_ANALYTICS_URL) {
    result.analyticsUrl = import.meta.env.VITE_ADMIN_ANALYTICS_URL;
  }
  if (import.meta.env.VITE_ADMIN_LOG_URL) {
    result.logsUrl = import.meta.env.VITE_ADMIN_LOG_URL;
  }
  return result;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") {
    return {
      ...DEFAULT_RUNTIME_CONFIG,
      ...readEnvFallback(),
    };
  }

  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...readEnvFallback(),
    ...(window.__ADMIN_RUNTIME_CONFIG__ ?? {}),
  };
}

export function buildInlineRuntimeConfigFallbackScript(): string {
  const payload = JSON.stringify({
    ...DEFAULT_RUNTIME_CONFIG,
    ...readEnvFallback(),
  }).replace(/</g, "\\u003c");

  return `window.__ADMIN_RUNTIME_CONFIG__ = window.__ADMIN_RUNTIME_CONFIG__ || ${payload};`;
}

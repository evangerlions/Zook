import type { BaiConfig } from "../shared/types.ts";
import {
  createDefaultTransparentProxyConfig,
  normalizeTransparentProxyConfig,
} from "./openrouter-config.ts";

const DEFAULT_BAI_PROXY_HMAC_SECRET_KEY = "bai.proxy.hmac_secret";

export function createDefaultBaiConfig(): BaiConfig {
  return createDefaultTransparentProxyConfig(
    "",
    DEFAULT_BAI_PROXY_HMAC_SECRET_KEY,
  );
}

export function normalizeBaiConfig(value: unknown): BaiConfig {
  return normalizeTransparentProxyConfig(
    value,
    createDefaultBaiConfig(),
    "B.AI",
  );
}

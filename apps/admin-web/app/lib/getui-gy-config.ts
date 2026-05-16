import type {
  AdminGetuiGyServiceDocument,
  GetuiGyAppCredentials,
  GetuiGyServiceConfig,
  GetuiGyServiceDraft,
} from "./types";

const DEFAULT_ENDPOINT = "https://openapi-gy.getui.com/v2/gy/ct_login/gy_get_pn";
const DEFAULT_TIMEOUT_MS = 8000;

export function createDefaultGetuiGyConfig(): GetuiGyServiceDraft {
  return {
    enabled: false,
    endpoint: DEFAULT_ENDPOINT,
    timeoutMs: String(DEFAULT_TIMEOUT_MS),
    apps: {},
  };
}

export function cloneGetuiGyConfig(
  config: GetuiGyServiceConfig | GetuiGyServiceDraft = createDefaultGetuiGyConfig(),
): GetuiGyServiceDraft {
  return {
    enabled: Boolean(config.enabled),
    endpoint: String(config.endpoint ?? DEFAULT_ENDPOINT),
    timeoutMs: config.timeoutMs == null ? String(DEFAULT_TIMEOUT_MS) : String(config.timeoutMs),
    apps: normalizeAppCredentials(config.apps),
  };
}

export function normalizeGetuiGyDocument(document: AdminGetuiGyServiceDocument | null) {
  return document;
}

export function serializeGetuiGyDraft(draft: GetuiGyServiceDraft): GetuiGyServiceConfig {
  const config: GetuiGyServiceConfig = {
    enabled: Boolean(draft.enabled),
    endpoint: String(draft.endpoint ?? "").trim(),
    timeoutMs: Number(String(draft.timeoutMs ?? "").trim()),
    apps: normalizeAppCredentials(draft.apps),
  };

  if (!config.endpoint) {
    throw new Error("请填写 GeYan 取号接口 Endpoint。");
  }

  try {
    const url = new URL(config.endpoint);
    if (url.protocol !== "https:") {
      throw new Error("endpoint must use https");
    }
  } catch {
    throw new Error("GeYan Endpoint 必须是有效的 HTTPS URL。");
  }

  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error("超时时间必须是正整数毫秒。");
  }

  if (config.enabled && Object.keys(config.apps).length === 0) {
    throw new Error("启用 GeYan 前至少要配置一条 Zook AppID 到 GeYan 凭据的映射。");
  }

  if (config.enabled) {
    const incompleteAppId = Object.entries(config.apps).find(([, credentials]) => (
      !credentials.appId ||
      !credentials.appKey ||
      !credentials.appSecret ||
      !credentials.masterSecret
    ))?.[0];
    if (incompleteAppId) {
      throw new Error(`启用 GeYan 前必须填写 ${incompleteAppId} 的 AppID、AppKey、AppSecret 和 MasterSecret。`);
    }
  }

  return config;
}

export function serializeGetuiGyDraftForPreview(draft: GetuiGyServiceDraft) {
  try {
    return serializeGetuiGyDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft.enabled),
      endpoint: String(draft.endpoint ?? ""),
      timeoutMs: String(draft.timeoutMs ?? ""),
      apps: normalizeAppCredentials(draft.apps),
    };
  }
}

export function formatGetuiGyConfigJson(
  config: GetuiGyServiceConfig | GetuiGyServiceDraft = createDefaultGetuiGyConfig(),
) {
  return JSON.stringify(serializeGetuiGyDraftForPreview(cloneGetuiGyConfig(config)), null, 2);
}

export function getGetuiGyDraftValidationError(draft: GetuiGyServiceDraft) {
  try {
    serializeGetuiGyDraft(draft);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "GeYan 配置校验失败。";
  }
}

export function createEmptyGetuiGyCredentials(appId = ""): GetuiGyAppCredentials {
  return {
    appId: "",
    appKey: "",
    appSecret: "",
    masterSecret: "",
  };
}

export function isDefaultGetuiGyCredentials(
  appId: string,
  credentials: GetuiGyAppCredentials,
): boolean {
  const defaults = createEmptyGetuiGyCredentials(appId);
  return (
    credentials.appId === defaults.appId &&
    credentials.appKey === defaults.appKey &&
    credentials.appSecret === defaults.appSecret &&
    credentials.masterSecret === defaults.masterSecret
  );
}

function normalizeAppCredentials(value: unknown): Record<string, GetuiGyAppCredentials> {
  const result: Record<string, GetuiGyAppCredentials> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value as Record<string, unknown>).forEach(([zookAppId, rawCredentials]) => {
      const key = zookAppId.trim();
      if (
        key &&
        rawCredentials &&
        typeof rawCredentials === "object" &&
        !Array.isArray(rawCredentials)
      ) {
        const credentials = rawCredentials as Record<string, unknown>;
        result[key] = {
          appId: typeof credentials.appId === "string" ? credentials.appId.trim() : "",
          appKey: typeof credentials.appKey === "string" ? credentials.appKey.trim() : "",
          appSecret: typeof credentials.appSecret === "string" ? credentials.appSecret.trim() : "",
          masterSecret: typeof credentials.masterSecret === "string" ? credentials.masterSecret.trim() : "",
        };
      }
    });
  }

  return result;
}

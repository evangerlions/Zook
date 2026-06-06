import { normalizeAppNameI18n, resolveAdminAppName } from "../../shared/app-name.ts";
import { badRequest } from "../../shared/errors.ts";
import type { AdminAppSummary, AppRecord } from "../../shared/types.ts";

export const ADMIN_CONFIG_KEY = "admin.delivery_config";
export const COMMON_APP_ID = "common";
export const APP_ID_PATTERN = /^[a-z0-9_]+$/;

export function buildDefaultConfigTemplate(appId: string): Record<string, string> {
  return {
    app: `make_${appId}_great_again`,
  };
}

export function normalizeConfig(rawJson: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson);
  } catch {
    badRequest("ADMIN_CONFIG_INVALID_JSON", "Config must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    badRequest("ADMIN_CONFIG_INVALID_JSON", "Config root must be a JSON object.");
  }

  return JSON.stringify(parsed, null, 2);
}

export function normalizeRequiredAppNames(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("REQ_INVALID_BODY", "appNameI18n must be a JSON object.");
  }

  const source = value as Record<string, unknown>;
  const zhCnName = typeof source["zh-CN"] === "string" ? source["zh-CN"].trim() : "";
  const enUsName = typeof source["en-US"] === "string" ? source["en-US"].trim() : "";
  if (!zhCnName) {
    badRequest("REQ_INVALID_BODY", "appNameI18n.zh-CN must be a non-empty string.");
  }

  if (!enUsName) {
    badRequest("REQ_INVALID_BODY", "appNameI18n.en-US must be a non-empty string.");
  }

  return normalizeAppNameI18n(source, enUsName);
}

export function commonAppSummary(): AdminAppSummary {
  return {
    appId: COMMON_APP_ID,
    appCode: COMMON_APP_ID,
    appName: "Common",
    appNameI18n: {
      "zh-CN": "公共工作区",
      "en-US": "Common",
    },
    status: "ACTIVE",
    canDelete: false,
    logSecret: {
      keyId: COMMON_APP_ID,
      secretMasked: "internal",
      updatedAt: new Date(0).toISOString(),
    },
  };
}

export function buildAdminAppSummary(
  app: AppRecord,
  logSecret: AdminAppSummary["logSecret"],
  canDelete: boolean,
): AdminAppSummary {
  return {
    appId: app.id,
    appCode: app.code,
    appName: resolveAdminAppName(app.nameI18n, app.name),
    appNameI18n: normalizeAppNameI18n(app.nameI18n, app.name),
    status: app.status,
    canDelete,
    logSecret,
  };
}

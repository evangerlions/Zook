import { normalizeLocale } from "./i18n.ts";
import type { AppNameI18n, TencentSesRegion } from "./types.ts";

const APP_NAME_MAINLAND_LOCALE = "zh-CN";
const APP_NAME_DEFAULT_LOCALE = "en-US";

export function createAppNameI18n(zhCnName: string, enUsName: string): AppNameI18n {
  return {
    "zh-CN": zhCnName.trim(),
    "en-US": enUsName.trim(),
  };
}

export function normalizeAppNameI18n(value: unknown, fallbackName = ""): AppNameI18n {
  const fallback = fallbackName.trim();
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const normalized: AppNameI18n = {
    "zh-CN": typeof source["zh-CN"] === "string" && source["zh-CN"].trim()
      ? source["zh-CN"].trim()
      : fallback,
    "en-US": typeof source["en-US"] === "string" && source["en-US"].trim()
      ? source["en-US"].trim()
      : fallback,
  };

  for (const [locale, text] of Object.entries(source)) {
    const normalizedLocale = normalizeLocale(locale);
    if (!normalizedLocale || typeof text !== "string" || !text.trim()) {
      continue;
    }

    normalized[normalizedLocale] = text.trim();
  }

  if (!normalized["zh-CN"]) {
    normalized["zh-CN"] = normalized["en-US"] || fallback;
  }

  if (!normalized["en-US"]) {
    normalized["en-US"] = normalized["zh-CN"] || fallback;
  }

  return normalized;
}

export function resolveAdminAppName(value: unknown, fallbackName = ""): string {
  const normalized = normalizeAppNameI18n(value, fallbackName);
  return normalized["zh-CN"] || normalized["en-US"] || fallbackName.trim();
}

export function resolveLocalizedAppName(
  value: unknown,
  options: {
    fallbackName?: string;
    locale?: string;
    region?: TencentSesRegion;
    countryCode?: string;
  } = {},
): string {
  const normalized = normalizeAppNameI18n(value, options.fallbackName);
  const normalizedCountryCode = options.countryCode?.trim().toUpperCase();

  if (normalizedCountryCode === "CN" || options.region === "ap-guangzhou") {
    return normalized[APP_NAME_MAINLAND_LOCALE] || normalized[APP_NAME_DEFAULT_LOCALE] || options.fallbackName?.trim() || "";
  }

  const normalizedLocale = normalizeLocale(options.locale);
  if (normalizedLocale && normalized[normalizedLocale]) {
    return normalized[normalizedLocale];
  }

  return normalized[APP_NAME_DEFAULT_LOCALE] || normalized[APP_NAME_MAINLAND_LOCALE] || options.fallbackName?.trim() || "";
}

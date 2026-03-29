import type { I18nSettings } from "./types.ts";

export type I18nText = Record<string, string>;
export type LocaleMatchType =
  | "exact"
  | "configured_fallback"
  | "language"
  | "default"
  | "first_available"
  | "none";

export interface LocaleMatchResult {
  locale?: string;
  matchType: LocaleMatchType;
}

export interface LocalizeFieldsOptions {
  removeSourceFields?: boolean;
  sourceSuffix?: string;
}

export interface ResolvedI18nText {
  text: string;
  locale?: string;
  matchType: LocaleMatchType;
}

export const DEFAULT_APP_I18N_SETTINGS: I18nSettings = {
  defaultLocale: "en-US",
  supportedLocales: [
    "en-US",
    "zh-CN",
    "zh-TW",
    "ja-JP",
    "es-ES",
    "pt-BR",
    "ko-KR",
    "de-DE",
    "fr-FR",
    "hi-IN",
    "id-ID",
    "it-IT",
    "tr-TR",
    "vi-VN",
    "th-TH",
    "pl-PL",
    "nl-NL",
    "sv-SE",
    "bn-BD",
    "sw-KE",
  ],
  fallbackLocales: {
    "en-GB": ["en-US"],
    "es-MX": ["es-ES"],
    "es-AR": ["es-ES"],
    "pt-PT": ["pt-BR"],
    "fr-CA": ["fr-FR"],
    "zh-HK": ["zh-TW", "zh-CN"],
    "zh-MO": ["zh-TW", "zh-CN"],
    "zh-SG": ["zh-CN"],
    "bn-IN": ["bn-BD"],
    "sw-TZ": ["sw-KE"],
  },
};

export function parseAcceptLanguage(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.split(";")[0]?.trim())
    .find(Boolean);
}

export function normalizeLocale(value?: string): string | undefined {
  const normalized = typeof value === "string" ? value.trim().replaceAll("_", "-") : "";
  if (!normalized) {
    return undefined;
  }

  const lowerCased = normalized.toLowerCase();
  if (lowerCased === "zh" || lowerCased === "zh-cn" || lowerCased.startsWith("zh-hans")) {
    return "zh-CN";
  }

  if (lowerCased === "zh-tw" || lowerCased.includes("hant") || lowerCased.endsWith("-tw")) {
    return "zh-TW";
  }

  if (lowerCased === "zh-hk" || lowerCased.endsWith("-hk")) {
    return "zh-HK";
  }

  if (lowerCased === "en" || lowerCased.startsWith("en-")) {
    return "en-US";
  }

  const parts = normalized.split("-").filter(Boolean);
  if (!parts.length) {
    return undefined;
  }

  const [language, ...rest] = parts;
  const region = rest.find((item) => /^[a-z]{2}$/i.test(item));
  if (!region) {
    return language.toLowerCase();
  }

  return `${language.toLowerCase()}-${region.toUpperCase()}`;
}

export function isI18nText(value: unknown): value is I18nText {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

export function resolveLocaleMatch(
  requestedLocale: string | undefined,
  availableLocales: string[],
  settings: Pick<I18nSettings, "defaultLocale" | "fallbackLocales">,
): LocaleMatchResult {
  const normalizedAvailableLocales = uniqueNormalizedLocales(availableLocales);
  if (!normalizedAvailableLocales.length) {
    return {
      matchType: "none",
    };
  }

  const availableLocaleSet = new Set(normalizedAvailableLocales);
  const normalizedDefaultLocale = normalizeLocale(settings.defaultLocale);
  const normalizedRequestedLocale = normalizeLocale(requestedLocale);

  if (normalizedRequestedLocale && availableLocaleSet.has(normalizedRequestedLocale)) {
    return {
      locale: normalizedRequestedLocale,
      matchType: "exact",
    };
  }

  if (normalizedRequestedLocale) {
    const configuredFallbacks = uniqueNormalizedLocales(settings.fallbackLocales[normalizedRequestedLocale] ?? []);
    for (const fallbackLocale of configuredFallbacks) {
      if (availableLocaleSet.has(fallbackLocale)) {
        return {
          locale: fallbackLocale,
          matchType: "configured_fallback",
        };
      }
    }

    const requestedLanguage = normalizedRequestedLocale.split("-")[0];
    if (availableLocaleSet.has(requestedLanguage)) {
      return {
        locale: requestedLanguage,
        matchType: "language",
      };
    }

    if (
      normalizedDefaultLocale
      && normalizedDefaultLocale.split("-")[0] === requestedLanguage
      && availableLocaleSet.has(normalizedDefaultLocale)
    ) {
      return {
        locale: normalizedDefaultLocale,
        matchType: "language",
      };
    }

    const sameLanguageLocale = normalizedAvailableLocales.find((item) => item.split("-")[0] === requestedLanguage);
    if (sameLanguageLocale) {
      return {
        locale: sameLanguageLocale,
        matchType: "language",
      };
    }
  }

  if (normalizedDefaultLocale && availableLocaleSet.has(normalizedDefaultLocale)) {
    return {
      locale: normalizedDefaultLocale,
      matchType: "default",
    };
  }

  return {
    locale: normalizedAvailableLocales[0],
    matchType: "first_available",
  };
}

export function resolveSupportedLocale(
  requestedLocale: string | undefined,
  settings: I18nSettings,
): LocaleMatchResult {
  return resolveLocaleMatch(requestedLocale, settings.supportedLocales, settings);
}

export function resolveI18nText(
  value: I18nText | undefined,
  locale: string,
  settings: I18nSettings,
): ResolvedI18nText {
  if (!value) {
    return {
      text: "",
      matchType: "none",
    };
  }

  const normalizedValue = normalizeI18nText(value);
  const match = resolveLocaleMatch(locale, Object.keys(normalizedValue), settings);
  if (!match.locale) {
    return {
      text: "",
      matchType: match.matchType,
    };
  }

  return {
    text: normalizedValue[match.locale] ?? "",
    locale: match.locale,
    matchType: match.matchType,
  };
}

export function pickI18nText(
  value: I18nText | undefined,
  locale: string,
  settings: I18nSettings,
): string {
  return resolveI18nText(value, locale, settings).text;
}

export function localizeFields<T extends Record<string, unknown>>(
  record: T,
  fieldNames: string[],
  locale: string,
  settings: I18nSettings,
  options: LocalizeFieldsOptions = {},
): T {
  const sourceSuffix = options.sourceSuffix ?? "_i18n";
  const removeSourceFields = options.removeSourceFields ?? false;
  const result = { ...record } as Record<string, unknown>;

  for (const fieldName of fieldNames) {
    const sourceFieldName = `${fieldName}${sourceSuffix}`;
    if (!(sourceFieldName in result)) {
      continue;
    }

    const sourceValue = result[sourceFieldName];
    result[fieldName] = isI18nText(sourceValue)
      ? pickI18nText(sourceValue, locale, settings)
      : "";

    if (removeSourceFields) {
      delete result[sourceFieldName];
    }
  }

  return result as T;
}

function normalizeI18nText(value: I18nText): I18nText {
  const normalizedEntries = Object.entries(value).flatMap(([key, text]) => {
    const normalizedKey = normalizeLocale(key);
    const normalizedText = typeof text === "string" ? text : "";
    return normalizedKey && normalizedText ? [[normalizedKey, normalizedText] satisfies [string, string]] : [];
  });

  return Object.fromEntries(normalizedEntries);
}

function uniqueNormalizedLocales(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const locale = normalizeLocale(value);
    if (!locale || seen.has(locale)) {
      continue;
    }

    seen.add(locale);
    normalized.push(locale);
  }

  return normalized;
}

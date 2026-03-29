import type { HttpRequest, I18nSettings } from "../shared/types.ts";
import type { LocaleMatchType } from "../shared/i18n.ts";
import { normalizeLocale, parseAcceptLanguage, resolveSupportedLocale } from "../shared/i18n.ts";
import { getHeader } from "../shared/utils.ts";

const DEFAULT_LOCALE = "en-US";

export type RequestLocaleSource =
  | "query"
  | "app_header"
  | "accept_language"
  | "preferred_locale"
  | "app_default"
  | "default";

export interface ResolveRequestLocaleOptions {
  preferredLocale?: string;
  appDefaultLocale?: string;
  supportedLocales?: string[];
  fallbackLocales?: Record<string, string[]>;
  queryKey?: string;
}

export interface ResolvedRequestLocaleContext {
  locale: string;
  requestedLocale?: string;
  localeSource: RequestLocaleSource;
  matchType: LocaleMatchType;
  defaultLocale: string;
}

export class RequestLocaleService {
  resolve(
    request: HttpRequest,
    options: ResolveRequestLocaleOptions = {},
  ): ResolvedRequestLocaleContext {
    const queryKey = options.queryKey ?? "locale";
    const defaultLocale = normalizeLocale(options.appDefaultLocale) ?? DEFAULT_LOCALE;
    const supportedLocales = this.normalizeSupportedLocales(options.supportedLocales, defaultLocale);
    const settings: I18nSettings = {
      defaultLocale,
      supportedLocales,
      fallbackLocales: this.normalizeFallbackLocales(options.fallbackLocales),
    };

    const candidates: Array<{ locale?: string; source: RequestLocaleSource }> = [
      {
        locale: normalizeLocale(typeof request.query?.[queryKey] === "string" ? request.query[queryKey] : undefined),
        source: "query",
      },
      {
        locale: normalizeLocale(getHeader(request.headers, "x-app-locale")),
        source: "app_header",
      },
      {
        locale: normalizeLocale(parseAcceptLanguage(getHeader(request.headers, "accept-language"))),
        source: "accept_language",
      },
      {
        locale: normalizeLocale(options.preferredLocale),
        source: "preferred_locale",
      },
      {
        locale: defaultLocale,
        source: "app_default",
      },
    ];

    for (const candidate of candidates) {
      if (!candidate.locale) {
        continue;
      }

      const match = resolveSupportedLocale(candidate.locale, settings);
      if (match.locale) {
        return {
          locale: match.locale,
          requestedLocale: candidate.locale,
          localeSource: candidate.source,
          matchType: match.matchType,
          defaultLocale,
        };
      }
    }

    return {
      locale: defaultLocale,
      localeSource: "default",
      matchType: "default",
      defaultLocale,
    };
  }

  private normalizeSupportedLocales(locales: string[] | undefined, defaultLocale: string): string[] {
    if (!Array.isArray(locales) || !locales.length) {
      return [defaultLocale];
    }

    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const locale of locales) {
      const normalizedLocale = normalizeLocale(locale);
      if (!normalizedLocale || seen.has(normalizedLocale)) {
        continue;
      }

      seen.add(normalizedLocale);
      normalized.push(normalizedLocale);
    }

    if (!seen.has(defaultLocale)) {
      normalized.unshift(defaultLocale);
    }

    return normalized;
  }

  private normalizeFallbackLocales(
    value: Record<string, string[]> | undefined,
  ): Record<string, string[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const normalized: Record<string, string[]> = {};
    for (const [requestedLocale, candidates] of Object.entries(value)) {
      const normalizedRequestedLocale = normalizeLocale(requestedLocale);
      if (!normalizedRequestedLocale || !Array.isArray(candidates)) {
        continue;
      }

      const seen = new Set<string>();
      normalized[normalizedRequestedLocale] = candidates.flatMap((candidate) => {
        const normalizedCandidate = normalizeLocale(candidate);
        if (!normalizedCandidate || seen.has(normalizedCandidate)) {
          return [];
        }

        seen.add(normalizedCandidate);
        return [normalizedCandidate];
      });
    }

    return normalized;
  }
}

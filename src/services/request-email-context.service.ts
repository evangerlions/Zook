import { InMemoryCache } from "../infrastructure/cache/redis/in-memory-cache.ts";
import type { HttpRequest, TencentSesRegion } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";

const DEFAULT_GEO_TIMEOUT_MS = 1500;
const DEFAULT_GEO_CACHE_TTL_SECONDS = 10 * 60;

export type CountrySource = "trusted_proxy" | "client_header" | "geo" | "none";
export type LocaleSource = "app_header" | "accept_language" | "country" | "default";

export interface ResolvedEmailRequestContext {
  locale: string;
  localeSource: LocaleSource;
  countryCode?: string;
  countrySource: CountrySource;
  region: TencentSesRegion;
}

export interface GeoResolver {
  resolveCountryCode(ipAddress: string, now?: Date): Promise<string | undefined>;
}

export class NoopGeoResolver implements GeoResolver {
  async resolveCountryCode(): Promise<string | undefined> {
    return undefined;
  }
}

export class HttpGeoResolver implements GeoResolver {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(
    options: {
      baseUrl: string;
      token?: string;
      timeoutMs?: number;
    },
    private readonly cache: InMemoryCache,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = options.baseUrl.trim();
    this.token = options.token?.trim() || undefined;
    this.timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_GEO_TIMEOUT_MS;
  }

  async resolveCountryCode(ipAddress: string, now = new Date()): Promise<string | undefined> {
    const normalizedIpAddress = ipAddress.trim();
    if (!normalizedIpAddress) {
      return undefined;
    }

    const cacheKey = `geo:country:${normalizedIpAddress}`;
    const cached = this.cache.get<string | null>(cacheKey, now);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.buildRequestUrl(normalizedIpAddress), {
        headers: {
          Accept: "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.cache.set(cacheKey, null, DEFAULT_GEO_CACHE_TTL_SECONDS, now);
        return undefined;
      }

      const payload = await response.json() as Record<string, unknown>;
      const countryCode = normalizeCountryCode(
        payload.countryCode
          ?? payload.country_code
          ?? readNestedCountryCode(payload.country),
      );

      this.cache.set(cacheKey, countryCode ?? null, DEFAULT_GEO_CACHE_TTL_SECONDS, now);
      return countryCode;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRequestUrl(ipAddress: string): string {
    if (this.baseUrl.includes("{ip}")) {
      return this.baseUrl.replaceAll("{ip}", encodeURIComponent(ipAddress));
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set("ip", ipAddress);
    return url.toString();
  }
}

export class RequestEmailContextService {
  constructor(private readonly geoResolver: GeoResolver = new NoopGeoResolver()) {}

  async resolve(request: HttpRequest, now = new Date()): Promise<ResolvedEmailRequestContext> {
    const trustedProxyCountryCode = request.trustedProxy
      ? normalizeCountryCode(getHeader(request.headers, "x-country-code"))
      : undefined;
    const clientCountryCode = normalizeCountryCode(getHeader(request.headers, "x-app-country-code"));
    const geoCountryCode = !trustedProxyCountryCode && !clientCountryCode && request.ipAddress
      ? await this.geoResolver.resolveCountryCode(request.ipAddress, now)
      : undefined;

    const countryCode = trustedProxyCountryCode ?? clientCountryCode ?? geoCountryCode;
    const countrySource: CountrySource = trustedProxyCountryCode
      ? "trusted_proxy"
      : clientCountryCode
        ? "client_header"
        : geoCountryCode
          ? "geo"
          : "none";

    const appLocale = normalizeLocale(getHeader(request.headers, "x-app-locale"));
    const acceptLanguageLocale = normalizeLocale(parseAcceptLanguage(getHeader(request.headers, "accept-language")));
    const localeFromCountry = deriveLocaleFromCountry(countryCode);

    const locale = appLocale ?? acceptLanguageLocale ?? localeFromCountry ?? "zh-CN";
    const localeSource: LocaleSource = appLocale
      ? "app_header"
      : acceptLanguageLocale
        ? "accept_language"
        : localeFromCountry
          ? "country"
          : "default";

    return {
      locale,
      localeSource,
      countryCode,
      countrySource,
      region: mapCountryCodeToRegion(countryCode, locale),
    };
  }
}

function readNestedCountryCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  return typeof source.code === "string"
    ? source.code
    : typeof source.isoCode === "string"
      ? source.isoCode
      : typeof source.iso_code === "string"
        ? source.iso_code
        : undefined;
}

function parseAcceptLanguage(value?: string): string | undefined {
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

function normalizeCountryCode(value?: string): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeLocale(value?: string): string | undefined {
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

function deriveLocaleFromCountry(countryCode?: string): string | undefined {
  if (!countryCode) {
    return undefined;
  }

  return countryCode === "CN" ? "zh-CN" : "en-US";
}

function mapCountryCodeToRegion(countryCode: string | undefined, locale: string): TencentSesRegion {
  if (countryCode === "CN") {
    return "ap-guangzhou";
  }

  if (countryCode) {
    return "ap-hongkong";
  }

  return locale === "zh-CN" ? "ap-guangzhou" : "ap-hongkong";
}

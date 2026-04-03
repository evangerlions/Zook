import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { DEFAULT_APP_I18N_SETTINGS, normalizeLocale } from "../shared/i18n.ts";
import type {
  AppI18nConfigDocument,
  ConfigRevisionMeta,
  I18nSettings,
} from "../shared/types.ts";

export const APP_I18N_SETTINGS_CONFIG_KEY = "i18n.settings";

export class AppI18nConfigService {
  constructor(private readonly appConfigService: VersionedAppConfigService) {}

  async getDocument(appId: string, revision?: number): Promise<AppI18nConfigDocument> {
    const revisions = await this.appConfigService.listRevisions(appId, APP_I18N_SETTINGS_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(appId, APP_I18N_SETTINGS_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(appId, APP_I18N_SETTINGS_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `i18n settings revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : await this.getCurrentConfig(appId);

    return this.createDocument(
      config,
      revisions,
      {
        updatedAt: record?.createdAt ?? await this.getUpdatedAt(appId),
        revision: record?.revision,
        desc: record?.desc,
        isLatest: !record || record.revision === latestRevision,
      },
    );
  }

  async updateConfig(appId: string, input: unknown, desc?: string): Promise<AppI18nConfigDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      appId,
      APP_I18N_SETTINGS_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "app-i18n-settings-update",
    );
    return this.getDocument(appId);
  }

  async restoreConfig(appId: string, revision: number): Promise<AppI18nConfigDocument> {
    const existing = await this.appConfigService.getRevision(appId, APP_I18N_SETTINGS_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `i18n settings revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      appId,
      APP_I18N_SETTINGS_CONFIG_KEY,
      revision,
      `恢复到版本 R${revision}`,
    );

    return this.getDocument(appId);
  }

  async getCurrentConfig(appId: string): Promise<I18nSettings> {
    const stored = await this.appConfigService.getValue(appId, APP_I18N_SETTINGS_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  async initializeAppConfig(appId: string, desc = "app-created"): Promise<void> {
    await this.appConfigService.setValue(
      appId,
      APP_I18N_SETTINGS_CONFIG_KEY,
      JSON.stringify(this.createDefaultConfig(), null, 2),
      desc,
    );
  }

  createDefaultConfig(): I18nSettings {
    return {
      defaultLocale: DEFAULT_APP_I18N_SETTINGS.defaultLocale,
      supportedLocales: [...DEFAULT_APP_I18N_SETTINGS.supportedLocales],
      fallbackLocales: Object.fromEntries(
        Object.entries(DEFAULT_APP_I18N_SETTINGS.fallbackLocales).map(([locale, candidates]) => [locale, [...candidates]]),
      ),
    };
  }

  private async getUpdatedAt(appId: string): Promise<string | undefined> {
    return this.appConfigService.getUpdatedAt(appId, APP_I18N_SETTINGS_CONFIG_KEY);
  }

  private createDocument(
    config: I18nSettings,
    revisions: ConfigRevisionMeta[],
    meta: {
      updatedAt?: string;
      revision?: number;
      desc?: string;
      isLatest: boolean;
    },
  ): AppI18nConfigDocument {
    return {
      configKey: APP_I18N_SETTINGS_CONFIG_KEY,
      config,
      updatedAt: meta.updatedAt,
      revision: meta.revision,
      desc: meta.desc,
      isLatest: meta.isLatest,
      revisions: [...revisions].reverse(),
    };
  }

  private parseConfig(raw: string): I18nSettings {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored i18n settings config is invalid.");
    }

    return this.validateInput(parsed);
  }

  private validateInput(input: unknown): I18nSettings {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_I18N_INVALID", "i18n settings must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const defaultLocale = this.requireLocale(source.defaultLocale, "defaultLocale is required.");
    const supportedLocales = this.normalizeSupportedLocales(source.supportedLocales);
    if (!supportedLocales.length) {
      badRequest("ADMIN_I18N_INVALID", "supportedLocales must contain at least one locale.");
    }

    if (!supportedLocales.includes(defaultLocale)) {
      badRequest("ADMIN_I18N_INVALID", "defaultLocale must be included in supportedLocales.");
    }

    const fallbackLocales = this.normalizeFallbackLocales(source.fallbackLocales, supportedLocales);
    return {
      defaultLocale,
      supportedLocales,
      fallbackLocales,
    };
  }

  private normalizeSupportedLocales(value: unknown): string[] {
    if (!Array.isArray(value)) {
      badRequest("ADMIN_I18N_INVALID", "supportedLocales must be an array.");
    }

    const seen = new Set<string>();
    const locales: string[] = [];

    value.forEach((item, index) => {
      const locale = this.requireLocale(item, `supportedLocales[${index}] must be a valid locale.`);
      if (seen.has(locale)) {
        badRequest("ADMIN_I18N_INVALID", `Duplicate supported locale is not allowed: ${locale}`);
      }

      seen.add(locale);
      locales.push(locale);
    });

    return locales;
  }

  private normalizeFallbackLocales(
    value: unknown,
    supportedLocales: string[],
  ): Record<string, string[]> {
    if (value === undefined) {
      return {};
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("ADMIN_I18N_INVALID", "fallbackLocales must be a JSON object.");
    }

    const supportedLocaleSet = new Set(supportedLocales);
    const normalized: Record<string, string[]> = {};

    for (const [requestedLocale, candidates] of Object.entries(value as Record<string, unknown>)) {
      const normalizedRequestedLocale = this.requireLocale(
        requestedLocale,
        `fallback locale key is invalid: ${requestedLocale}`,
      );

      if (!Array.isArray(candidates)) {
        badRequest("ADMIN_I18N_INVALID", `fallbackLocales.${normalizedRequestedLocale} must be an array.`);
      }

      const seen = new Set<string>();
      normalized[normalizedRequestedLocale] = candidates.map((candidate, index) => {
        const locale = this.requireLocale(
          candidate,
          `fallbackLocales.${normalizedRequestedLocale}[${index}] must be a valid locale.`,
        );
        if (!supportedLocaleSet.has(locale)) {
          badRequest(
            "ADMIN_I18N_INVALID",
            `Fallback locale ${locale} must exist in supportedLocales.`,
          );
        }

        if (seen.has(locale)) {
          badRequest(
            "ADMIN_I18N_INVALID",
            `Duplicate fallback locale is not allowed: ${normalizedRequestedLocale} -> ${locale}`,
          );
        }

        seen.add(locale);
        return locale;
      });
    }

    return normalized;
  }

  private requireLocale(value: unknown, message: string): string {
    const locale = normalizeLocale(typeof value === "string" ? value : undefined);
    if (!locale) {
      badRequest("ADMIN_I18N_INVALID", message);
    }

    return locale;
  }
}

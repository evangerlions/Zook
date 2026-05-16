import { AppI18nConfigService } from "./app-i18n-config.service.ts";
import { RequestLocaleService, type ResolvedRequestLocaleContext } from "./request-locale.service.ts";
import {
  localizeFields,
  pickI18nText,
  resolveI18nText,
  type I18nText,
  type LocalizeFieldsOptions,
  type ResolvedI18nText,
} from "../shared/i18n.ts";
import type { HttpRequest, I18nSettings } from "../shared/types.ts";

export class I18nService {
  constructor(
    private readonly appI18nConfigService: AppI18nConfigService,
    private readonly requestLocaleService = new RequestLocaleService(),
  ) {}

  async getSettings(appId: string): Promise<I18nSettings> {
    return this.appI18nConfigService.getCurrentConfig(appId);
  }

  async resolveRequestLocale(
    request: HttpRequest,
    appId: string,
    preferredLocale?: string,
  ): Promise<ResolvedRequestLocaleContext> {
    const settings = await this.getSettings(appId);
    return this.requestLocaleService.resolve(request, {
      preferredLocale,
      appDefaultLocale: settings.defaultLocale,
      supportedLocales: settings.supportedLocales,
      fallbackLocales: settings.fallbackLocales,
    });
  }

  async pickText(
    value: I18nText | undefined,
    locale: string,
    appId: string,
  ): Promise<string> {
    return pickI18nText(value, locale, await this.getSettings(appId));
  }

  async resolveText(
    value: I18nText | undefined,
    locale: string,
    appId: string,
  ): Promise<ResolvedI18nText> {
    return resolveI18nText(value, locale, await this.getSettings(appId));
  }

  async localizeFields<T extends Record<string, unknown>>(
    record: T,
    fieldNames: string[],
    locale: string,
    appId: string,
    options?: LocalizeFieldsOptions,
  ): Promise<T> {
    return localizeFields(record, fieldNames, locale, await this.getSettings(appId), options);
  }
}

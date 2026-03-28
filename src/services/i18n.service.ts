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

  getSettings(appId: string): I18nSettings {
    return this.appI18nConfigService.getCurrentConfig(appId);
  }

  resolveRequestLocale(
    request: HttpRequest,
    appId: string,
    preferredLocale?: string,
  ): ResolvedRequestLocaleContext {
    const settings = this.getSettings(appId);
    return this.requestLocaleService.resolve(request, {
      preferredLocale,
      appDefaultLocale: settings.defaultLocale,
      supportedLocales: settings.supportedLocales,
      fallbackLocales: settings.fallbackLocales,
    });
  }

  pickText(
    value: I18nText | undefined,
    locale: string,
    appId: string,
  ): string {
    return pickI18nText(value, locale, this.getSettings(appId));
  }

  resolveText(
    value: I18nText | undefined,
    locale: string,
    appId: string,
  ): ResolvedI18nText {
    return resolveI18nText(value, locale, this.getSettings(appId));
  }

  localizeFields<T extends Record<string, unknown>>(
    record: T,
    fieldNames: string[],
    locale: string,
    appId: string,
    options?: LocalizeFieldsOptions,
  ): T {
    return localizeFields(record, fieldNames, locale, this.getSettings(appId), options);
  }
}

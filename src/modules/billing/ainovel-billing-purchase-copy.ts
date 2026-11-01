import { DEFAULT_APP_I18N_SETTINGS, isI18nText, pickI18nText } from "../../shared/i18n.ts";

/** Optional public copy within the existing ai_novel.billing_benefits config. */
export function billingPurchaseSubtitle(locale = "en-US", rawConfig?: string): string | null {
  return localizedPurchaseCopy("purchaseSubtitle", locale, rawConfig);
}

export function billingPurchaseTitle(locale = "en-US", rawConfig?: string): string | null {
  return localizedPurchaseCopy("purchaseTitle", locale, rawConfig);
}

function localizedPurchaseCopy(key: "purchaseTitle" | "purchaseSubtitle", locale: string, rawConfig?: string): string | null {
  const value = rawConfig === undefined ? undefined : JSON.parse(rawConfig)?.[key];
  if (value === undefined || value === null) return null;
  if (!isI18nText(value)) throw new Error(`Invalid billing ${key} configuration`);
  return pickI18nText(value, locale, DEFAULT_APP_I18N_SETTINGS).trim() || null;
}

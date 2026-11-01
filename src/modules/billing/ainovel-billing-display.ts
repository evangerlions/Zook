import { DEFAULT_APP_I18N_SETTINGS, isI18nText, pickI18nText } from "../../shared/i18n.ts";

/** Presentation only. This configuration cannot change products, prices or access. */
export function billingDisplay(locale = "en-US", rawConfig?: string) {
  const config = rawConfig === undefined ? {} : JSON.parse(rawConfig);
  const localize = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    if (!isI18nText(value)) throw new Error("Invalid billing display configuration");
    return pickI18nText(value, locale, DEFAULT_APP_I18N_SETTINGS).trim() || null;
  };
  const page = config.display ?? {};
  const webUrl = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value.trim());
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.toString() : null;
    } catch { return null; }
  };
  const allowedProductKeys = new Set(["plus_monthly", "plus_quarterly", "plus_yearly", "pro_monthly", "pro_quarterly", "pro_yearly"]);
  const defaultProductKey = allowedProductKeys.has(page.defaultProductKey) ? page.defaultProductKey : "plus_monthly";
  return {
    page: {
      title: localize(page.title), agreement: localize(page.agreement),
      plusLabel: localize(page.plusLabel), proLabel: localize(page.proLabel), defaultProductKey,
      paidServiceUrl: webUrl(page.paidServiceUrl), debitAuthorizationUrl: webUrl(page.debitAuthorizationUrl),
    },
    product(productKey: string) {
      const product = config.products?.[productKey] ?? {};
      return {
        displayName: localize(product.displayName),
        periodLabel: localize(product.periodLabel),
        badgeText: localize(product.badgeText),
      };
    },
  };
}

/** Optional checkout copy is best-effort, never a prerequisite for an order.
 * Ignore unrelated page labels and fall back per invalid/missing field. */
export function billingCheckoutDisplay(productKey: string, locale = "en-US", rawConfig?: string) {
  let config: Record<string, unknown> = {};
  try {
    config = displayObject(JSON.parse(rawConfig ?? "{}"));
  } catch {
    // Malformed presentation JSON is equivalent to absent checkout overrides.
  }
  const qr = displayObject(config.checkoutDisplay);
  const product = displayObject(displayObject(config.products)[productKey]);
  const localize = (value: unknown): string | null => isI18nText(value)
    ? pickI18nText(value, locale, DEFAULT_APP_I18N_SETTINGS).trim() || null : null;
  return {
    title: localize(qr.title), hint: localize(qr.hint), waiting: localize(qr.waiting),
    productName: localize(product.displayName),
  };
}

function displayObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function billingAmountText(amountMinor: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "CNY", currencyDisplay: "narrowSymbol" }).format(amountMinor / 100);
}

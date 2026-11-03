import { ApplicationError } from "../../shared/errors.ts";
import type { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import type { AlipayProductKey } from "./alipay-models.ts";

export const ALIPAY_PRODUCT_KEYS: readonly AlipayProductKey[] = [
  "plus_monthly", "plus_quarterly", "plus_yearly", "pro_monthly", "pro_quarterly", "pro_yearly",
];
export type AlipayPrices = Record<AlipayProductKey, number>;
// Settlement accepts at most ten integer CNY digits and two fraction digits.
export const MAX_ALIPAY_PRICE_MINOR = 999_999_999_999;

export function validAlipayPrices(value: unknown): value is AlipayPrices {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prices = value as Record<string, unknown>;
  return Object.keys(prices).length === ALIPAY_PRODUCT_KEYS.length && ALIPAY_PRODUCT_KEYS.every(key =>
    typeof prices[key] === "number" && Number.isSafeInteger(prices[key]) && prices[key] > 0 && prices[key] <= MAX_ALIPAY_PRICE_MINOR);
}

/** Absence stops new sales; it never changes an existing order's frozen price. */
export function aiNovelAlipayPrices(config: Record<string, unknown>): AlipayPrices | undefined {
  const billing = config.billing as { alipay?: { prices?: unknown } } | undefined;
  const prices = billing?.alipay?.prices;
  return validAlipayPrices(prices) ? prices : undefined;
}

export function validateAiNovelAlipayPricing(appId: string, rawJson: string): void {
  if (appId !== "ai_novel") return;
  const config = JSON.parse(rawJson) as Record<string, unknown>;
  const billing = config.billing as { alipay?: unknown } | undefined;
  if (billing?.alipay === undefined) return;
  const alipay = billing.alipay;
  if (!alipay || typeof alipay !== "object" || Array.isArray(alipay) ||
    Object.keys(alipay).some(key => key !== "prices") ||
    !validAlipayPrices((alipay as { prices?: unknown }).prices)) {
    throw new ApplicationError(400, "ADMIN_CONFIG_INVALID_JSON", "billing.alipay.prices must contain all six products with integer CNY minor-unit prices from 1 to 999999999999.");
  }
}

export async function readAiNovelAlipayPrices(service: VersionedAppConfigService): Promise<AlipayPrices | undefined> {
  const raw = await service.getValue("ai_novel", "admin.delivery_config");
  if (!raw) return undefined;
  return aiNovelAlipayPrices(JSON.parse(raw) as Record<string, unknown>);
}

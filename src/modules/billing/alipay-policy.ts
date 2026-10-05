import { ApplicationError } from "../../shared/errors.ts";
import type { AiNovelBillingMembershipRecord } from "../../shared/types.ts";
import type { AlipayCreateInput, AlipayOptions, AlipayOrder, AlipayPublicOrder } from "./alipay-models.ts";
import { billingChannelsConflict } from "./billing-channel-policy.ts";

export const ALIPAY_PRICES = { plus_monthly: 3800, plus_quarterly: 9800, plus_yearly: 29800,
  pro_monthly: 8800, pro_quarterly: 22800, pro_yearly: 59800 } as const;

export function alipayConfigured(options: AlipayOptions): boolean {
  const https = (url?: string) => { try { return new URL(url!).protocol === "https:"; } catch { return false; } };
  return options.enabled === true && !!options.appId?.trim() &&
    (options.environment === "sandbox" || options.environment === "production") &&
    (options.environment !== "production" || (options.pricesApproved === true && !!options.prices)) &&
    (!options.prices || Object.keys(ALIPAY_PRICES).every(key => Number.isSafeInteger(options.prices![key as keyof typeof ALIPAY_PRICES]) && options.prices![key as keyof typeof ALIPAY_PRICES] > 0)) &&
    https(options.notifyUrl) && https(options.returnUrl) &&
    (!!options.gateway || (!!options.privateKeyPath && !!options.publicKeyPath));
}
export function assertAlipayChannel(region: string, platform: string, distribution: string): void {
  if (region !== "CN" || !((platform === "android" && ["china_android_store", "direct_android"].includes(distribution)) ||
    (platform === "web" && distribution === "web") || (platform === "windows" && distribution === "windows"))) {
    throw new ApplicationError(403, "BILLING_CHANNEL_UNSUPPORTED", "Alipay requires a CN account and a supported distribution.");
  }
}
export function parseAlipayCreate(body: unknown): AlipayCreateInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => !["productKey", "platform", "distribution", "idempotencyKey"].includes(key)) ||
    typeof value.productKey !== "string" || !Object.hasOwn(ALIPAY_PRICES, value.productKey) ||
    !["android", "web", "windows"].includes(String(value.platform)) ||
    !["china_android_store", "direct_android", "web", "windows"].includes(String(value.distribution)) ||
    typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.idempotencyKey)) invalid();
  return value as unknown as AlipayCreateInput;
}
function invalid(): never { throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid Alipay order request."); }
export function membershipConflict(current: AiNovelBillingMembershipRecord | undefined, product: string, now: Date) {
  if (!current?.active || current.accountDeletedAt || (current.expiresAt && Date.parse(current.expiresAt) <= now.getTime())) return null;
  if (billingChannelsConflict(current.source, "alipay")) return "provider_conflict" as const;
  return null;
}
export function addMembershipPeriod(start: Date, product: string): string {
  const months = product.endsWith("_yearly") ? 12 : product.endsWith("_quarterly") ? 3 : 1;
  const end = new Date(start); const day = end.getUTCDate();
  end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last)); return end.toISOString();
}
export function publicAlipayOrder(order: AlipayOrder): AlipayPublicOrder {
  const { orderId, provider, environment, productKey, status, amountMinor, currency, createdAt, expiresAt, paidAt, membershipApplied, conflict } = order;
  return { orderId, provider, environment, productKey, status, amountMinor, currency, createdAt, expiresAt, paidAt, membershipApplied, conflict };
}
export function parseAlipayMoney(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function alipayPaidAt(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return undefined;
  const time = Date.parse(value.replace(" ", "T") + "+08:00");
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

import type { AiNovelBillingTier, AiNovelBillingSource, AiNovelBillingTransactionRecord } from "../../shared/types.ts";
export const PRODUCTS: Record<string, { tier: AiNovelBillingTier; rank: number }> = {
  plus_monthly: { tier: "plus", rank: 1 },
  plus_quarterly: { tier: "plus", rank: 1 },
  plus_yearly: { tier: "plus", rank: 1 },
  pro_monthly: { tier: "pro", rank: 2 },
  pro_quarterly: { tier: "pro", rank: 2 },
  pro_yearly: { tier: "pro", rank: 2 },
};

export function parseDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function sourceFromStore(value: unknown): AiNovelBillingSource | undefined {
  if (value === "app_store" || value === "mac_app_store") return "app_store";
  if (value === "play_store") return "play_store";
  return undefined;
}

export function platformFromStore(value: unknown): AiNovelBillingTransactionRecord["platform"] {
  if (value === "app_store") return "ios";
  if (value === "mac_app_store") return "macos";
  if (value === "play_store") return "android";
  return null;
}

export function nullableString(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

export function safeManagementUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

export function toMinorUnits(value: unknown, currency: string | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !currency) return null;
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    const amount = Math.round(value * (10 ** digits));
    return Number.isSafeInteger(amount) ? amount : null;
  } catch {
    return null;
  }
}

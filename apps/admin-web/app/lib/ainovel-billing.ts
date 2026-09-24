import type { AdminBillingOrder, AiNovelBillingOrderStatus } from "./types";

export const BILLING_STATUS_OPTIONS: Array<{ value: AiNovelBillingOrderStatus; label: string }> = [
  { value: "entitlement_active", label: "会员有效" },
  { value: "provider_paid", label: "已支付" },
  { value: "expired", label: "已过期" },
  { value: "refunded", label: "已退款" },
  { value: "revoked", label: "已撤销" },
  { value: "unknown", label: "未知" },
];

export function billingStatusLabel(value: string): string {
  if (value === "active") return "权益有效";
  if (value === "cancelled") return "已取消续订";
  if (value === "grace_period") return "宽限期";
  if (value === "unknown") return "未知";
  return BILLING_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export function billingStatusColor(value: string): string {
  switch (value) {
    case "entitlement_active": return "green";
    case "active": return "green";
    case "provider_paid": return "blue";
    case "refunded": return "red";
    case "revoked": return "volcano";
    case "expired": return "default";
    case "unknown": return "default";
    default: return "default";
  }
}

export function formatBillingMoney(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || !currency) return "—";
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
    }).format(amountMinor / (10 ** digits));
  } catch {
    return "—";
  }
}

export function billingProductLabel(order: AdminBillingOrder): string {
  const tier = order.tier === "plus" ? "Plus" : order.tier === "pro" ? "Pro" : order.tier;
  const period = order.billingPeriod === "P1M" ? "月度" : order.billingPeriod === "P3M" ? "季度" : order.billingPeriod === "P1Y" ? "年度" : "";
  return [tier, period].filter(Boolean).join(" · ");
}

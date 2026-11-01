import { billingMarket } from "../modules/billing/billing-market.ts";
import { DEFAULT_BILLING_REVENUE_DIMENSIONS } from "../modules/billing/billing-revenue-dimensions.ts";
import type { AiNovelBillingTransactionRecord } from "../shared/types.ts";
import type { BillingRevenueRow, BillingSummaryFilter } from "../shared/types/billing-admin.ts";

export function aggregateBillingRevenue(records: AiNovelBillingTransactionRecord[], filter: BillingSummaryFilter): BillingRevenueRow[] {
  const dimensions = filter.groupBy ?? DEFAULT_BILLING_REVENUE_DIMENSIONS;
  const rows = new Map<string, BillingRevenueRow>();
  const from = Date.parse(filter.from), to = Date.parse(filter.to);
  function add(item: AiNovelBillingTransactionRecord, timestamp: string | null, amount: number | null, refund: boolean) {
    if (!timestamp || amount === null || amount <= 0) return;
    const time = Date.parse(timestamp);
    if (!Number.isFinite(time) || time < from || time >= to) return;
    const date = new Date(time).toISOString().slice(0, 10);
    const appId = dimensions.includes("appId") ? item.appId : null;
    const productKey = dimensions.includes("productKey") ? item.productKey : null;
    const source = dimensions.includes("source") ? item.source : null;
    const market = dimensions.includes("market") ? billingMarket(item) : null;
    const key = JSON.stringify([date, appId, productKey, source, market, item.currency]);
    const row = rows.get(key) ?? { date, appId, productKey, source, market, currency: item.currency!,
      purchaseCount: 0, grossMinor: 0, refundMinor: 0 };
    if (refund) row.refundMinor += amount;
    else { row.purchaseCount++; row.grossMinor += amount; }
    if (![row.grossMinor, row.refundMinor].every(Number.isSafeInteger)) throw new Error("Billing aggregate exceeds safe integer range");
    rows.set(key, row);
  }
  for (const item of records) {
    if (item.isSandbox !== filter.sandbox || !item.currency) continue;
    // A checkout quote is not provider settlement, even with malformed dates.
    if (["pending", "closed", "failed"].includes(item.status)) continue;
    add(item, item.purchasedAt, item.amountMinor, false);
    add(item, item.refundedAt, item.refundAmountMinor, true);
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date)
    || (a.appId ?? "").localeCompare(b.appId ?? "") || (a.productKey ?? "").localeCompare(b.productKey ?? "") || (a.source ?? "").localeCompare(b.source ?? "") || (a.market ?? "").localeCompare(b.market ?? "") || a.currency.localeCompare(b.currency));
}

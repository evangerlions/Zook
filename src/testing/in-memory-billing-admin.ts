import type { AiNovelBillingTransactionRecord } from "../shared/types.ts";
import type { BillingRevenueRow, BillingSummaryFilter } from "../shared/types/billing-admin.ts";

export function aggregateBillingRevenue(records: AiNovelBillingTransactionRecord[], filter: BillingSummaryFilter): BillingRevenueRow[] {
  const rows = new Map<string, BillingRevenueRow>();
  const from = Date.parse(filter.from), to = Date.parse(filter.to);
  function add(item: AiNovelBillingTransactionRecord, timestamp: string | null, amount: number | null, refund: boolean) {
    if (!timestamp || amount === null || amount <= 0) return;
    const time = Date.parse(timestamp);
    if (!Number.isFinite(time) || time < from || time >= to) return;
    const date = new Date(time).toISOString().slice(0, 10);
    const key = JSON.stringify([date, item.appId, item.source, item.currency]);
    const row = rows.get(key) ?? { date, appId: item.appId, source: item.source, currency: item.currency!,
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
    || a.appId.localeCompare(b.appId) || a.source.localeCompare(b.source) || a.currency.localeCompare(b.currency));
}

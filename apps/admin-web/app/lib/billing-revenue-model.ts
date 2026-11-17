import type { BillingRevenue, BillingRevenueDimension } from './billing-admin-api.ts';
import { billingTermValue } from './billing-terms.ts';

export const REVENUE_DIMENSIONS: BillingRevenueDimension[] = ['appId', 'source', 'productKey', 'market'];
export function dimensionLabel(dimension: BillingRevenueDimension, value: string | null): string {
  if (dimension === 'source' || dimension === 'market') return billingTermValue(dimension, value);
  return value || '—';
}
export function groupRevenue(rows: BillingRevenue[], dimensions: BillingRevenueDimension[]): BillingRevenue[] {
  const groups = new Map<string, BillingRevenue>();
  for (const row of rows) {
    const key = JSON.stringify([row.date, row.currency, ...dimensions.map(d => row[d])]);
    let item = groups.get(key);
    if (!item) {
      item = { date: row.date, currency: row.currency, appId: null, source: null, market: null, productKey: null, purchaseCount: 0, grossMinor: 0, refundMinor: 0 };
      for (const dim of dimensions) item[dim] = row[dim];
      groups.set(key, item);
    }
    item.purchaseCount += row.purchaseCount;
    item.grossMinor += row.grossMinor;
    item.refundMinor += row.refundMinor;
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}
export function totalRevenue(rows: BillingRevenue[]) {
  return rows.reduce((sum, row) => ({ grossMinor: sum.grossMinor + row.grossMinor, refundMinor: sum.refundMinor + row.refundMinor, purchaseCount: sum.purchaseCount + row.purchaseCount }), { grossMinor: 0, refundMinor: 0, purchaseCount: 0 });
}
export function revenueDays(from: string, to: string): string[] {
  const start = new Date(from); const end = new Date(to);
  const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const result: string[] = [];
  while (day < end) { result.push(day.toISOString().slice(0, 10)); day.setUTCDate(day.getUTCDate() + 1); }
  return result;
}
export function revenueSeries(rows: BillingRevenue[], dimension: BillingRevenueDimension, days: string[]) {
  const groups = new Map<string | null, Map<string, number>>();
  for (const row of rows) {
    const key = row[dimension];
    if (!groups.has(key)) groups.set(key, new Map());
    const values = groups.get(key)!;
    values.set(row.date, (values.get(row.date) ?? 0) + row.grossMinor);
  }
  return [...groups].map(([key, values]) => ({ key, label: dimensionLabel(dimension, key), values: days.map(day => values.get(day) ?? 0) }));
}
export function revenueDistribution(rows: BillingRevenue[], dimension: BillingRevenueDimension) {
  const values = new Map<string | null, number>();
  for (const row of rows) values.set(row[dimension], (values.get(row[dimension]) ?? 0) + row.grossMinor);
  return [...values].filter(([, value]) => value > 0).map(([key, value]) => ({ name: dimensionLabel(dimension, key), value })).sort((a, b) => b.value - a.value);
}

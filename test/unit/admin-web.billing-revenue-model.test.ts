import assert from 'node:assert/strict';
import test from 'node:test';
import { groupRevenue, revenueDays, revenueDistribution, revenueSeries, totalRevenue } from '../../apps/admin-web/app/lib/billing-revenue-model.ts';
import type { BillingRevenue } from '../../apps/admin-web/app/lib/billing-admin-api.ts';

const row = (overrides: Partial<BillingRevenue>): BillingRevenue => ({ date: '2026-11-01', appId: 'ai_novel', productKey: 'plus', source: 'alipay', market: null, currency: 'CNY', purchaseCount: 1, grossMinor: 100, refundMinor: 0, ...overrides });
const rows = [row({}), row({ market: 'xiaomi', productKey: 'pro', grossMinor: 200, refundMinor: 40 }), row({ date: '2026-11-03', source: 'app_store', market: 'app_store', grossMinor: 300 })];

test('reaggregates all rows and retains independent dimensions and refunds', () => {
  assert.deepEqual(totalRevenue(rows), { grossMinor: 600, refundMinor: 40, purchaseCount: 3 });
  const grouped = groupRevenue(rows, ['appId']);
  assert.equal(grouped.length, 2);
  assert.deepEqual([grouped[1].grossMinor, grouped[1].refundMinor, grouped[1].purchaseCount], [300, 40, 2]);
  assert.equal(groupRevenue(rows, ['market']).length, 3);
});
test('fills UTC dates and preserves unknown market attribution', () => {
  const days = revenueDays('2026-11-01T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
  assert.deepEqual(days, ['2026-11-01', '2026-11-02', '2026-11-03']);
  const series = revenueSeries(rows, 'market', days);
  assert.deepEqual(series.find(item => item.key === null)?.values, [100, 0, 0]);
  assert.equal(series.find(item => item.key === null)?.label, '未知渠道');
  assert.deepEqual(revenueDistribution(rows, 'market').map(item => item.value), [300, 200, 100]);
});
test('does not merge currencies when grouping', () => {
  const result = groupRevenue([row({}), row({ currency: 'USD', grossMinor: 75 })], ['appId']);
  assert.equal(result.length, 2);
});

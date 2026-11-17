import { Alert, Button, DatePicker, Select, Space, Table, Tabs, Tag } from 'antd';
import type { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { billingAdminApi, type BillingRevenue, type BillingRevenueDimension } from '../lib/billing-admin-api';
import { formatBillingMoney } from '../lib/billing-format';
import { groupRevenue, totalRevenue } from '../lib/billing-revenue-model';
import { BILLING_TERMS, billingTermValue } from '../lib/billing-terms';
import { useBillingQuery } from '../lib/use-billing-query';
import type { BillingEnvironment } from '../lib/billing-preferences';
import { BillingRevenueCharts } from './billing-revenue-charts';

const dimensionOptions = [
  { value: 'appId', label: '应用' }, { value: 'productKey', label: '商品代号' },
  { value: 'source', label: BILLING_TERMS.source.label }, { value: 'market', label: BILLING_TERMS.market.label },
];

export function BillingOverviewSection({ appId, environment }: { appId: string; environment: BillingEnvironment }) {
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [dimensions, setDimensions] = useState<BillingRevenueDimension[]>(['appId']);
  const [selectedCurrency, setSelectedCurrency] = useState<string>();
  const query = { appId, environment, groupBy: 'appId,productKey,source,market',
    from: dates?.[0] ? `${dates[0].format('YYYY-MM-DD')}T00:00:00.000Z` : undefined,
    to: dates?.[1] ? `${dates[1].add(1, 'day').format('YYYY-MM-DD')}T00:00:00.000Z` : undefined };
  const result = useBillingQuery(() => billingAdminApi.overview(query), JSON.stringify(query));
  const currencies = useMemo(() => [...new Set((result.data?.rows ?? []).map(row => row.currency))].sort(), [result.data]);
  const currency = selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : currencies.includes('CNY') ? 'CNY' : currencies[0] ?? '';
  const rows = useMemo(() => (result.data?.rows ?? []).filter(row => row.currency === currency), [result.data, currency]);
  const grouped = useMemo(() => groupRevenue(rows, dimensions), [rows, dimensions]);
  const totals = totalRevenue(rows);
  const columns = [
    { title: '日期（UTC）', dataIndex: 'date', width: 135 },
    ...(dimensions.includes('appId') ? [{ title: '应用', dataIndex: 'appId' }] : []),
    ...(dimensions.includes('productKey') ? [{ title: '商品代号', dataIndex: 'productKey' }] : []),
    ...(dimensions.includes('source') ? [{ title: BILLING_TERMS.source.label, dataIndex: 'source', render: (value: string | null) => billingTermValue('source', value) }] : []),
    ...(dimensions.includes('market') ? [{ title: BILLING_TERMS.market.label, dataIndex: 'market', render: (value: string | null) => billingTermValue('market', value) }] : []),
    { title: '币种', dataIndex: 'currency' }, { title: '付费交易数', dataIndex: 'purchaseCount' },
    { title: '购买金额', render: (_: unknown, row: BillingRevenue) => formatBillingMoney(row.grossMinor, row.currency) },
    { title: '退款金额', render: (_: unknown, row: BillingRevenue) => formatBillingMoney(row.refundMinor, row.currency) },
  ];
  return <section className="stack">
    <Space wrap><span>日期（UTC）</span><DatePicker.RangePicker value={dates} onChange={setDates} />
      <span>币种</span><Select aria-label="币种" style={{ minWidth: 110 }} value={currency || undefined} options={currencies.map(value => ({ value, label: value }))} onChange={setSelectedCurrency} placeholder="暂无数据" />
      <Button onClick={result.refresh}>刷新</Button></Space>
    <Alert showIcon type="info" message="默认本月，最多 366 天。按 UTC 日期和币种统计已确认金额；不含未知金额、未知环境，不等于商店税费扣除后的实际结算收入。退款计入退款当天，购买计入购买当天。" />
    {result.error ? <Alert type="error" message={result.error} /> : null}
    {result.data ? <Space><Tag>{billingTermValue('environment', environment)}</Tag><span>{result.data.from} — {result.data.to}（结束时间不含）</span></Space> : null}
    <Tabs defaultActiveKey="charts" items={[
      { key: 'charts', label: '图表概览', children: result.data ? <BillingRevenueCharts data={result.data} rows={rows} currency={currency} /> : <CardLoading loading={result.loading} /> },
      { key: 'details', label: '统计明细', children: <div className="stack">
        <Space wrap><span>统计维度</span><Select aria-label="收入统计维度" mode="multiple" style={{ minWidth: 280 }} value={dimensions} options={dimensionOptions} onChange={(values: BillingRevenueDimension[]) => setDimensions(values.length ? values : ['appId'])} /></Space>
        <Table<BillingRevenue> key={`${appId}:${environment}:${dimensions.join(',')}:${currency}`} loading={result.loading} pagination={{ pageSize: 50 }} scroll={{ x: 850 }} dataSource={grouped}
          rowKey={row => JSON.stringify([row.date, row.appId, row.productKey, row.source, row.market, row.currency])} columns={columns}
          summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={columns.length - 2}><strong>合计（全部结果）</strong></Table.Summary.Cell><Table.Summary.Cell index={columns.length - 2}>{formatBillingMoney(totals.grossMinor, currency)}</Table.Summary.Cell><Table.Summary.Cell index={columns.length - 1}>{formatBillingMoney(totals.refundMinor, currency)}</Table.Summary.Cell></Table.Summary.Row>} />
      </div> },
    ]} />
  </section>;
}
function CardLoading({ loading }: { loading: boolean }) { return loading ? <span>加载中…</span> : null; }

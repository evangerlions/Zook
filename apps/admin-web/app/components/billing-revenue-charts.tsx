import { Card, Col, Empty, Radio, Row, Statistic } from 'antd';
import { useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import type { BillingOverview, BillingRevenue, BillingRevenueDimension } from '../lib/billing-admin-api';
import { formatBillingMoney } from '../lib/billing-format';
import { revenueDays, revenueDistribution, revenueSeries, totalRevenue } from '../lib/billing-revenue-model';
import { LlmChart } from './llm-monitor/llm-chart';

const dimensions: { key: BillingRevenueDimension; label: string }[] = [
  { key: 'source', label: '支付来源' }, { key: 'productKey', label: '商品代号' }, { key: 'market', label: '渠道' },
];
type Metric = 'grossMinor' | 'refundMinor' | 'purchaseCount';
function lineOption(days: string[], series: { name: string; values: number[] }[], currency: string, metric: Metric = 'grossMinor'): EChartsCoreOption {
  return {
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => metric === 'purchaseCount' ? String(value) : formatBillingMoney(Number(value), currency) },
    legend: { type: 'scroll', bottom: 0 }, grid: { top: 24, left: 88, right: 20, bottom: 70 },
    xAxis: { type: 'category', data: days, boundaryGap: false, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (value: number) => metric === 'purchaseCount' ? String(value) : formatBillingMoney(value, currency) } },
    series: series.map(s => ({ name: s.name, type: 'line', showSymbol: false, data: s.values })),
  };
}
function pieOption(rows: BillingRevenue[], dimension: BillingRevenueDimension, currency: string): EChartsCoreOption {
  return { tooltip: { trigger: 'item', valueFormatter: (value: unknown) => formatBillingMoney(Number(value), currency) }, legend: { type: 'scroll', bottom: 0 },
    series: [{ type: 'pie', radius: ['35%', '65%'], center: ['50%', '43%'], label: { formatter: '{b}: {d}%' }, data: revenueDistribution(rows, dimension) }] };
}
export function BillingRevenueCharts({ data, rows, currency }: { data: BillingOverview; rows: BillingRevenue[]; currency: string }) {
  const [metric, setMetric] = useState<Metric>('grossMinor');
  const days = useMemo(() => revenueDays(data.from, data.to), [data.from, data.to]);
  const totals = totalRevenue(rows);
  const dailyTotals = useMemo(() => days.map(date => totalRevenue(rows.filter(row => row.date === date))), [days, rows]);
  const dailyOption = useMemo(() => ({ ...lineOption(days, [{ name: metric === 'purchaseCount' ? '付费交易数' : metric === 'refundMinor' ? '退款金额' : '购买金额', values: dailyTotals.map(item => item[metric]) }], currency, metric),
    tooltip: { trigger: 'axis' as const, formatter: (points: { dataIndex: number }[]) => {
      const index = points[0].dataIndex; const total = dailyTotals[index];
      return `${days[index]}<br/>购买金额：${formatBillingMoney(total.grossMinor, currency)}<br/>退款金额：${formatBillingMoney(total.refundMinor, currency)}<br/>付费交易数：${total.purchaseCount}`;
    } },
  }), [days, dailyTotals, currency, metric]);
  const dimensionOptions = useMemo(() => dimensions.map(({ key, label }) => ({ key, label, option: lineOption(days, revenueSeries(rows, key, days).map(s => ({ name: s.label, values: s.values })), currency) })), [days, rows, currency]);
  if (!currency) return <Empty description="所选时间范围没有收入数据" />;
  return <div className="stack">
    <Row gutter={[16, 16]}>{[['购买总额', formatBillingMoney(totals.grossMinor, currency)], ['退款总额', formatBillingMoney(totals.refundMinor, currency)], ['付费交易数', totals.purchaseCount]].map(([title, value]) => <Col xs={24} sm={8} key={title}><Card><Statistic title={title} value={value} /></Card></Col>)}</Row>
    <Card title="每日趋势" extra={<Radio.Group value={metric} onChange={e => setMetric(e.target.value)} options={[{ label: '购买金额', value: 'grossMinor' }, { label: '退款金额', value: 'refundMinor' }, { label: '付费交易数', value: 'purchaseCount' }]} optionType="button" buttonStyle="solid" />}><LlmChart option={dailyOption} summary="按 UTC 日期统计的每日趋势" /></Card>
    <Row gutter={[16, 16]}>{dimensionOptions.map(({ key, label, option }) => <Col xs={24} xl={12} key={key}><Card title={`${label}趋势`}><LlmChart option={option} summary={`${label}每日购买金额趋势，点击图例显示或隐藏`} /></Card></Col>)}</Row>
    <Row gutter={[16, 16]}>{[{ key: 'appId' as const, label: '应用' }, ...dimensions].map(({ key, label }) => <Col xs={24} md={12} xl={6} key={key}><Card title={`${label}占比`}><Distribution rows={rows} dimension={key} currency={currency} label={label} /></Card></Col>)}</Row>
  </div>;
}

function Distribution({ rows, dimension, currency, label }: { rows: BillingRevenue[]; dimension: BillingRevenueDimension; currency: string; label: string }) {
  const values = revenueDistribution(rows, dimension);
  const total = values.reduce((sum, item) => sum + item.value, 0);
  if (!values.length) return <Empty description="暂无购买金额" />;
  return <><LlmChart option={pieOption(rows, dimension, currency)} summary={`${label}购买金额占比`} />
    <div>{values.map(item => <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{item.name}</span><span>{formatBillingMoney(item.value, currency)} · {(item.value / total * 100).toFixed(1)}%</span></div>)}</div></>;
}

import { BILLING_TERMS, billingTermValue } from "../lib/billing-terms";
import { Alert, Button, DatePicker, Select, Space, Table, Tag } from "antd";
import type { Dayjs } from "dayjs";
import { useState } from "react";
import { billingAdminApi, type BillingRevenue, type BillingRevenueDimension } from "../lib/billing-admin-api";
import { formatBillingMoney } from "../lib/billing-format";
import { useBillingQuery } from "../lib/use-billing-query";
import type { BillingEnvironment } from "../lib/billing-preferences";

export function BillingOverviewSection({ appId, environment }: { appId: string; environment: BillingEnvironment }) {
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [dimensions, setDimensions] = useState<BillingRevenueDimension[]>(["appId"]);
  const query = { appId, environment, groupBy: dimensions.join(","), from: dates?.[0]?.startOf("day").toISOString(), to: dates?.[1]?.add(1, "day").startOf("day").toISOString() };
  const result = useBillingQuery(() => billingAdminApi.overview(query), JSON.stringify(query));
  return <section className="stack">
    <Space wrap><span>统计维度</span><Select aria-label="收入统计维度" mode="multiple" style={{ minWidth: 280 }} value={dimensions}
      options={[{ value: "appId", label: "应用" }, { value: "productKey", label: "商品代号" }, { value: "source", label: BILLING_TERMS.source.label }, { value: "market", label: BILLING_TERMS.market.label }]}
      onChange={(values: BillingRevenueDimension[]) => setDimensions(values.length ? values : ["appId"])} />
      <DatePicker.RangePicker value={dates} onChange={setDates} /><Button onClick={result.refresh}>刷新</Button></Space>
    <Alert showIcon type="info" message="默认本月，最多 366 天。按所选维度、UTC 日期和币种分别统计已确认金额；不含未知金额、未知环境，不等于商店税费扣除后的实际结算收入。退款计入退款当天，购买计入购买当天；无记录的日期不展示。" />
    {result.error ? <Alert type="error" message={result.error} /> : null}
    {result.data ? <Space><Tag>{billingTermValue("environment", environment)}</Tag><span>{result.data.from} — {result.data.to}（结束时间不含）</span></Space> : null}
    <Table<BillingRevenue> key={`${appId}:${environment}:${query.groupBy}`} loading={result.loading} pagination={{ pageSize: 50 }} scroll={{ x: 850 }} dataSource={result.data?.rows ?? []} rowKey={(row) => `${row.date}:${row.appId}:${row.productKey}:${row.source}:${row.market}:${row.currency}`} columns={[
      { title: "日期（UTC）", dataIndex: "date", width: 135 },
      ...(dimensions.includes("appId") ? [{ title: "应用", dataIndex: "appId" }] : []),
      ...(dimensions.includes("productKey") ? [{ title: "商品代号", dataIndex: "productKey" }] : []),
      ...(dimensions.includes("source") ? [{ title: BILLING_TERMS.source.label, dataIndex: "source", render: (value: string | null) => billingTermValue("source", value) }] : []),
      ...(dimensions.includes("market") ? [{ title: BILLING_TERMS.market.label, dataIndex: "market", render: (value: string | null) => billingTermValue("market", value) }] : []),
      { title: "币种", dataIndex: "currency" }, { title: "付费交易数", dataIndex: "purchaseCount" },
      { title: "购买金额", render: (_, row) => formatBillingMoney(row.grossMinor, row.currency) },
      { title: "退款金额", render: (_, row) => formatBillingMoney(row.refundMinor, row.currency) },
    ]} />
  </section>;
}

import { Alert, Button, DatePicker, Select, Space, Table, Tag } from "antd";
import type { Dayjs } from "dayjs";
import { useState } from "react";
import { billingAdminApi, type BillingRevenue } from "../lib/billing-admin-api";
import { formatBillingMoney } from "../lib/billing-format";
import { useBillingQuery } from "../lib/use-billing-query";

export function BillingOverviewSection({ appId }: { appId: string }) {
  const [environment, setEnvironment] = useState("PRODUCTION");
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const query = { appId, environment, from: dates?.[0]?.startOf("day").toISOString(), to: dates?.[1]?.add(1, "day").startOf("day").toISOString() };
  const result = useBillingQuery(() => billingAdminApi.overview(query), JSON.stringify(query));
  return <section className="stack">
    <Space wrap><Select aria-label="统计环境" value={environment} onChange={setEnvironment} style={{ width: 160 }} options={[{ value: "PRODUCTION", label: "正式支付" }, { value: "SANDBOX", label: "Sandbox 测试" }]} /><DatePicker.RangePicker value={dates} onChange={setDates} /><Button onClick={result.refresh}>刷新</Button></Space>
    <Alert showIcon type="info" message="默认本月，最多 366 天。按 UTC 日期、币种和渠道分别统计已确认金额；不含未知金额、未知环境，不等于商店税费扣除后的实际结算收入。退款计入退款当天，购买计入购买当天；无记录的日期不展示。" />
    {result.error ? <Alert type="error" message={result.error} /> : null}
    {result.data ? <Space><Tag>{environment}</Tag><span>{result.data.from} — {result.data.to}（结束时间不含）</span></Space> : null}
    <Table<BillingRevenue> loading={result.loading} pagination={{ pageSize: 50 }} scroll={{ x: 850 }} dataSource={result.data?.rows ?? []} rowKey={(row) => `${row.date}:${row.appId}:${row.source}:${row.currency}`} columns={[
      { title: "日期（UTC）", dataIndex: "date", width: 135 },
      { title: "应用", dataIndex: "appId" }, { title: "渠道", dataIndex: "source" }, { title: "币种", dataIndex: "currency" }, { title: "付费交易数", dataIndex: "purchaseCount" },
      { title: "购买金额", render: (_, row) => formatBillingMoney(row.grossMinor, row.currency) },
      { title: "退款金额", render: (_, row) => formatBillingMoney(row.refundMinor, row.currency) },
    ]} />
  </section>;
}

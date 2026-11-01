import { BILLING_TERMS, billingTermValue } from "../lib/billing-terms";
import type { BillingEnvironment } from "../lib/billing-preferences";
import { Alert, Button, Input, Select, Space, Table } from "antd";
import { useState } from "react";
import { billingAdminApi, type BillingMember } from "../lib/billing-admin-api";
import { formatTimestamp } from "../lib/format";
import { useBillingQuery } from "../lib/use-billing-query";
import { BillingMembershipStatus } from "./billing-membership-status";

export function BillingMembershipsSection({ appId, environment, onOpenPayments }: {
  appId: string;
  environment: BillingEnvironment;
  onOpenPayments?: (member: BillingMember) => void;
}) {
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState<string>();
  const [cursor, setCursor] = useState<string>();
  const [expiry, setExpiry] = useState<"expired" | "not_expired">();
  const query = { appId, environment, userId, cursor, expiry };
  const result = useBillingQuery(() => billingAdminApi.memberships(query), JSON.stringify(query));
  return <section className="stack">
    <Space wrap><Input aria-label="会员用户 ID" placeholder="精确用户 ID" value={input} onChange={(event) => setInput(event.target.value)} />
      <Select<"all" | "expired" | "not_expired"> aria-label="会员到期筛选" value={expiry ?? "all"} style={{ width: 160 }} options={[{ value: "all", label: "全部会员" }, { value: "expired", label: "已过期" }, { value: "not_expired", label: "尚未过期" }]} onChange={(value) => { setExpiry(value === "all" ? undefined : value); setCursor(undefined); }} />
      <Button onClick={() => { setUserId(input.trim() || undefined); setCursor(undefined); }}>查询</Button><Button onClick={() => { setInput(""); setUserId(undefined); setExpiry(undefined); setCursor(undefined); result.refresh(); }}>清空</Button><Button onClick={result.refresh}>刷新</Button></Space>
    <Alert showIcon type="info" message={`当前仅显示${environment === "SANDBOX" ? "沙箱" : "正式"}会员。会员状态按应用和支付环境隔离，以 Zook 当前快照和到期时间为准。没有同步过会员状态的用户不在列表中。软删除账号保留记录但不视为有效会员。`} />
    {result.error ? <Alert type="error" message={result.error} /> : null}
    <Table<BillingMember> loading={result.loading} pagination={false} dataSource={result.data?.items ?? []} rowKey={(row) => `${row.appId}:${row.environment}:${row.userId}`} scroll={{ x: 1100 }} columns={[
      { title: "应用", dataIndex: "appId" }, { title: "用户 ID", dataIndex: "userId", render: (value, member) => onOpenPayments
        ? <Button type="link" style={{ padding: 0, height: "auto" }} onClick={() => onOpenPayments(member)}>{value}</Button>
        : value },
      { title: "会员状态", render: (_, row) => <BillingMembershipStatus member={row} /> },
      { title: BILLING_TERMS.tier.label, dataIndex: "tier", render: (value) => billingTermValue("tier", value) }, { title: "商品代号", dataIndex: "planKey" }, { title: BILLING_TERMS.source.label, dataIndex: "source", render: (value) => billingTermValue("source", value) },
      { title: "到期时间", dataIndex: "expiresAt", render: formatTimestamp },
      { title: "自动续订", render: (_, row) => row.autoRenew === null ? "未知" : row.autoRenew ? "是" : "否" },
      { title: "最后同步", dataIndex: "lastSyncedAt", render: formatTimestamp },
    ]} />
    <Space>{cursor ? <Button onClick={() => setCursor(undefined)}>回到首页</Button> : null}{result.data?.nextCursor ? <Button onClick={() => setCursor(result.data!.nextCursor!)}>下一页</Button> : null}</Space>
  </section>;
}

import { Alert, Button, Input, Space, Table, Tag } from "antd";
import { useState } from "react";
import { billingAdminApi, type BillingMember } from "../lib/billing-admin-api";
import { formatTimestamp } from "../lib/format";
import { useBillingQuery } from "../lib/use-billing-query";

export function BillingMembershipsSection({ appId }: { appId: string }) {
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState<string>();
  const [cursor, setCursor] = useState<string>();
  const query = { appId, userId, cursor };
  const result = useBillingQuery(() => billingAdminApi.memberships(query), JSON.stringify(query));
  return <section className="stack">
    <Space><Input aria-label="会员用户 ID" placeholder="精确用户 ID" value={input} onChange={(event) => setInput(event.target.value)} /><Button onClick={() => { setUserId(input.trim() || undefined); setCursor(undefined); }}>查询</Button><Button onClick={() => { setInput(""); setUserId(undefined); setCursor(undefined); result.refresh(); }}>清空</Button><Button onClick={result.refresh}>刷新</Button></Space>
    <Alert showIcon type="info" message="会员状态按应用隔离，以 Zook 当前快照和到期时间为准。此列表包含测试及正式会员；没有同步过会员状态的用户不在列表中。软删除账号保留记录但不视为有效会员。" />
    {result.error ? <Alert type="error" message={result.error} /> : null}
    <Table<BillingMember> loading={result.loading} pagination={false} dataSource={result.data?.items ?? []} rowKey={(row) => `${row.appId}:${row.userId}`} scroll={{ x: 1100 }} columns={[
      { title: "应用", dataIndex: "appId" }, { title: "用户 ID", dataIndex: "userId" },
      { title: "会员状态", render: (_, row) => <Space><Tag color={row.active ? "green" : "default"}>{row.active ? "有效" : "无效"}</Tag>{row.state}{row.accountDeletedAt ? <Tag>账号已删除</Tag> : null}</Space> },
      { title: "等级", dataIndex: "tier" }, { title: "套餐", dataIndex: "planKey" }, { title: "渠道", dataIndex: "source" },
      { title: "到期时间", dataIndex: "expiresAt", render: formatTimestamp },
      { title: "自动续订", render: (_, row) => row.autoRenew === null ? "未知" : row.autoRenew ? "是" : "否" },
      { title: "最后同步", dataIndex: "lastSyncedAt", render: formatTimestamp },
    ]} />
    <Space>{cursor ? <Button onClick={() => setCursor(undefined)}>回到首页</Button> : null}{result.data?.nextCursor ? <Button onClick={() => setCursor(result.data!.nextCursor!)}>下一页</Button> : null}</Space>
  </section>;
}

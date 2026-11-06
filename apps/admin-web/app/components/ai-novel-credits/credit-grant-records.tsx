import { Alert, Button, Card, Space, Table } from "antd";
import { useState } from "react";
import { listCreditGrants, type CreditGrantRecord } from "../../lib/ai-novel-credit-admin-api";
import { useBillingQuery } from "../../lib/use-billing-query";

export function CreditGrantRecords({ revision }: { revision: number }) {
  const [offset, setOffset] = useState(0);
  const result = useBillingQuery(() => listCreditGrants(offset), `${offset}:${revision}`);
  return <Card title="发放记录" extra={<Button onClick={result.refresh}>刷新</Button>}>
    {result.error && <Alert type="error" message={result.error} />}
    <Table<CreditGrantRecord> rowKey={r => `${r.uid}:${r.id}`} loading={result.loading} dataSource={result.data?.items ?? []} pagination={false} columns={[
      { title: "时间", dataIndex: "at" }, { title: "用户 UID", dataIndex: "uid" },
      { title: "点数", dataIndex: "points" }, { title: "操作人", dataIndex: "adminUser" },
    ]} />
    <Space style={{ marginTop: 16 }}><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</Button><Button disabled={!result.data?.hasMore} onClick={() => setOffset(offset + 50)}>下一页</Button></Space>
  </Card>;
}

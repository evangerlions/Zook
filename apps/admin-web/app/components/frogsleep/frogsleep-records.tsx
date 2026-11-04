import { Alert, Button, Card, Empty, Input, Select, Space, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { frogSleepAdminApi, type FrogSleepAdminPage, type FrogSleepAdminResource, type FrogSleepAdminRow } from "../../lib/frogsleep-admin-api";
import { formatApiError } from "../../lib/format";
import { SensitiveOperationModal } from "../sensitive-operation-modal";
import { resourceLabels } from "./frogsleep-labels";

export function FrogSleepRecords({ onRetry, revision }: { onRetry: (id: string) => void; revision: number }) {
  const [authorized, setAuthorized] = useState(false), [verify, setVerify] = useState(false);
  const [resource, setResource] = useState<FrogSleepAdminResource>("relationships");
  const [user, setUser] = useState(""), [status, setStatus] = useState("");
  const [filter, setFilter] = useState({ user: "", status: "" }), [page, setPage] = useState(1);
  const [document, setDocument] = useState<FrogSleepAdminPage | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setDocument(null); setError("");
    if (!authorized) return;
    setLoading(true);
    frogSleepAdminApi.records(resource, page, filter.user, filter.status).then(result => { if (current) setDocument(result); })
      .catch(err => { if (current) setError(formatApiError(err)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [authorized, resource, page, filter, refresh, revision]);
  const columns = [
    { title: "记录 ID", dataIndex: "id", ellipsis: true }, { title: "状态", dataIndex: "status", render: (s: string) => <Tag>{s}</Tag> },
    { title: "用户 ID", dataIndex: "user_id", ellipsis: true }, { title: "另一方 ID", dataIndex: "partner_user_id", ellipsis: true },
    { title: "域 / 通道", dataIndex: "domain" }, { title: "版本", dataIndex: "version" },
    { title: "尝试次数", dataIndex: "attempts" }, { title: "投递结果", dataIndex: "outcome" }, { title: "更新于", dataIndex: "updated_at" },
    ...(resource === "notifications" ? [{ title: "操作", render: (_: unknown, row: FrogSleepAdminRow) =>
      ["FAILED", "ENQUEUE_FAILED"].includes(row.status) && (row.attempts ?? 0) < 5 && row.outcome !== "PROVIDER_OUTCOME_UNKNOWN"
        ? <Button size="small" onClick={() => onRetry(row.id)}>重试</Button> : "—" }] : []),
  ];
  return <Card title="记录查询" extra={authorized ? <Button onClick={() => setRefresh(v => v + 1)}>刷新记录</Button> : null}>
    <Alert type="info" showIcon title="仅展示运维元数据" description="查询需要二次验证。不展示私人报告正文、邀请码、邮箱或推送 token。" />
    <Space wrap className="frogsleep-record-filters">
      <Select aria-label="记录类型" value={resource} options={Object.entries(resourceLabels).map(([value,label]) => ({value,label}))}
        onChange={value => { setResource(value); setPage(1); }} />
      <Input aria-label="用户 ID" placeholder="用户 ID（精确匹配）" value={user} maxLength={200} onChange={e => setUser(e.target.value)} />
      <Input aria-label="记录状态" placeholder="状态（精确匹配）" value={status} maxLength={200} onChange={e => setStatus(e.target.value)} />
      <Button disabled={!authorized} onClick={() => { setFilter({ user, status }); setPage(1); }}>查询</Button>
    </Space>
    {!authorized ? <Empty description="完成二次验证后可查询账号、关系和投递状态"><Button type="primary" onClick={() => setVerify(true)}>验证并查看记录</Button></Empty>
      : error ? <Alert type="error" showIcon title="记录查询失败" description={error} action={<Button onClick={() => setVerify(true)}>重新验证</Button>} />
      : <Table<FrogSleepAdminRow> loading={loading} rowKey={row => `${row.user_id ?? ""}:${row.id}`} dataSource={document?.items ?? []} columns={columns} scroll={{ x: 1300 }}
        locale={{ emptyText: "没有符合条件的记录" }} pagination={{ current: page, pageSize: 25, total: document?.total ?? 0, showSizeChanger: false, onChange: setPage }} />}
    <SensitiveOperationModal open={verify} operation="frogsleep.records.read" title="验证 Sleep 记录查询权限" description="查看用户级运维元数据。"
      onClose={() => setVerify(false)} onAuthorized={() => { setAuthorized(true); setRefresh(v => v + 1); }} />
  </Card>;
}

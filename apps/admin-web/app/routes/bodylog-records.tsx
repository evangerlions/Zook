import { Button, Card, DatePicker, Input, Space, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type { AdminSensitiveOperationGrantDocument, BodyLogCheckinRecordsDocument } from "../lib/types";

export default function BodyLogRecordsRoute() {
  const { selectedAppId, setNotice, completeWorkspaceTransition } = useAdminSession();
  const [records, setRecords] = useState<BodyLogCheckinRecordsDocument | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [authorized, setAuthorized] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  async function loadRecords() {
    try {
      setRecords(await adminApi.getBodyLogCheckinRecords({ query: query || undefined, from, to, page: 1, limit: 50 }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    if (selectedAppId !== "bodylog") { setRecords(null); completeWorkspaceTransition(); return; }
    if (authorized) void loadRecords(); else completeWorkspaceTransition();
  }, [selectedAppId, authorized]);

  async function onAuthorized(_grant: AdminSensitiveOperationGrantDocument) {
    setAuthorized(true);
    await loadRecords();
  }

  async function exportCsv() {
    try {
      const blob = await adminApi.exportBodyLogCheckinRecordsCsv({ from, to });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "bodylog-checkin-records.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    }
  }

  if (selectedAppId !== "bodylog") return <section className="empty-state">请先切换到 BodyLog 项目空间。</section>;
  return <section className="stack">
    <header className="page-header"><div><h1>打卡记录</h1><p>查询用户级打卡记录。查看与导出均需要二次授权。</p></div></header>
    <Card>
      <Space wrap>
        <Input placeholder="用户 ID / 邮箱 / 手机号" value={query} onChange={event => setQuery(event.target.value)} allowClear />
        <DatePicker.RangePicker onChange={dates => { setFrom(dates?.[0]?.format("YYYY-MM-DD")); setTo(dates?.[1]?.format("YYYY-MM-DD")); }} />
        <Button type="primary" onClick={() => { if (!authorized) setModalOpen(true); else void loadRecords(); }}>查询</Button>
        <Button disabled={!authorized} onClick={() => void exportCsv()}>导出 CSV</Button>
      </Space>
    </Card>
    {records ? <Card title={`共 ${records.total} 条记录`}><Table rowKey={(row) => `${row.recordId}-${row.userId}`} dataSource={records.items} pagination={false} columns={[
      { title: "日期", dataIndex: "date" }, { title: "用户", dataIndex: "userId" }, { title: "群组", dataIndex: "groupName" },
      { title: "完成数", render: (_, row) => `${row.completedCount} / ${row.totalMembers}` },
      { title: "完成率", dataIndex: "completionRate", render: value => <Tag color={value >= 80 ? "green" : "orange"}>{Math.round(value)}%</Tag> },
      { title: "记录时间", dataIndex: "createdAt" },
    ]} /></Card> : <section className="empty-state">请先完成二次授权并查询。</section>}
    <SensitiveOperationModal open={modalOpen} operation="bodylog.checkin-records.read" title="授权查看打卡记录" description="请输入二次授权验证码。" onClose={() => setModalOpen(false)} onAuthorized={onAuthorized} />
  </section>;
}

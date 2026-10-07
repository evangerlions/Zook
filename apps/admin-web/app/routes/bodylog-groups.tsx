import { Button, Card, Drawer, Select, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type { AdminSensitiveOperationGrantDocument, BodyLogGroupHealth, BodyLogGroupMember, BodyLogGroupListDocument } from "../lib/types";

export default function BodyLogGroupsRoute() {
  const { selectedAppId, setNotice, completeWorkspaceTransition } = useAdminSession();
  const [document, setDocument] = useState<BodyLogGroupListDocument | null>(null);
  const [health, setHealth] = useState<string>();
  const [drawerGroup, setDrawerGroup] = useState<BodyLogGroupHealth | null>(null);
  const [members, setMembers] = useState<BodyLogGroupMember[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  async function loadGroups() {
    try { setDocument(await adminApi.listBodyLogGroups({ health })); }
    catch (error) { setNotice(makeNotice("error", formatApiError(error))); }
    finally { completeWorkspaceTransition(); }
  }

  useEffect(() => {
    if (selectedAppId !== "bodylog") { setDocument(null); completeWorkspaceTransition(); return; }
    void loadGroups();
  }, [selectedAppId, health]);

  async function loadMembers(_grant: AdminSensitiveOperationGrantDocument) {
    if (!drawerGroup) return;
    try { setMembers((await adminApi.getBodyLogGroupMemberContributions(drawerGroup.groupId)).items); }
    catch (error) { setNotice(makeNotice("error", formatApiError(error))); }
  }

  if (selectedAppId !== "bodylog") return <section className="empty-state">请先切换到 BodyLog 项目空间。</section>;
  return <section className="stack">
    <header className="page-header"><div><h1>群组监控</h1><p>查看群组活跃度与聚合贡献；成员明细需要二次授权。</p></div><Select allowClear placeholder="健康状态" value={health} onChange={setHealth} options={[{ value: "active", label: "活跃" }, { value: "stale", label: "沉寂" }, { value: "dead", label: "失活" }]} /></header>
    {document ? <Card><Table rowKey="groupId" dataSource={document.items} pagination={{ pageSize: document.limit, total: document.total }} columns={[
      { title: "群组", dataIndex: "name" }, { title: "状态", dataIndex: "status" }, { title: "成员", dataIndex: "memberCount" },
      { title: "近 7 天打卡", dataIndex: "checkins7d" }, { title: "近 30 天打卡", dataIndex: "checkins30d" },
      { title: "近 7 天完成率", dataIndex: "completionRate7d", render: value => <Tag color={value >= 80 ? "green" : "orange"}>{Math.round(value)}%</Tag> },
      { title: "操作", render: (_, row) => <Button onClick={() => { setDrawerGroup(row); setMembers([]); setModalOpen(true); }}>成员贡献</Button> },
    ]} /></Card> : <section className="empty-state">正在加载群组…</section>}
    <SensitiveOperationModal open={modalOpen} operation="bodylog.checkin-records.read" title="授权查看成员贡献" description="请输入二次授权验证码。" onClose={() => setModalOpen(false)} onAuthorized={loadMembers} />
    <Drawer title={drawerGroup ? `${drawerGroup.name} 成员贡献` : "成员贡献"} open={Boolean(drawerGroup && !modalOpen)} onClose={() => setDrawerGroup(null)} width={720}>
      <Table rowKey="userId" dataSource={members} pagination={false} columns={[{ title: "用户", dataIndex: "userId" }, { title: "角色", dataIndex: "role" }, { title: "打卡数", dataIndex: "checkinCount" }, { title: "最后打卡", dataIndex: "lastCheckinAt" }]} />
    </Drawer>
  </section>;
}

import { Alert, Card, Descriptions, Space, Statistic, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type { AdminAiRoutingDocument, LightTickAdminOperationsDocument } from "../lib/types";

export default function LightTickRoute() {
  const { selectedAppId, setNotice, completeWorkspaceTransition } = useAdminSession();
  const [document, setDocument] = useState<LightTickAdminOperationsDocument | null>(null);
  const [routing, setRouting] = useState<AdminAiRoutingDocument | null>(null);
  useEffect(() => {
    if (selectedAppId !== "lighttick") { setDocument(null); completeWorkspaceTransition(); return; }
    Promise.all([adminApi.getLightTickOperations(), adminApi.getAiRouting("lighttick")]).then(([operations, aiRouting]) => {
      setDocument(operations); setRouting(aiRouting);
    }).catch(error => setNotice(makeNotice("error", formatApiError(error))))
      .finally(completeWorkspaceTransition);
  }, [selectedAppId]);
  if (selectedAppId !== "lighttick") return <section className="empty-state">请先切换到 LightTick 项目空间。</section>;
  if (!document) return <section className="empty-state">正在加载 LightTick 运维状态…</section>;
  return <section className="stack">
    <header className="page-header"><div><h1>LightTick Operations</h1><p>聚合指标、功能开关、通知能力与 AI 场景边界。</p></div></header>
    <Alert type={document.enabled ? "success" : "warning"} showIcon message={document.enabled ? "LightTick 已启用" : "LightTick 默认关闭"}
      description="此页面只展示聚合运维数据，不读取用户私密文本、任务笔记或 Coach 对话。" />
    <Space wrap>{Object.entries(document.metrics).map(([key, value]) => <Card key={key}><Statistic title={key} value={value} /></Card>)}</Space>
    <Card title="功能与通知"><Descriptions column={2} items={[
      ...Object.entries(document.feature_flags).map(([key, value]) => ({ key, label: key, children: <Tag color={value ? "green" : "default"}>{String(value)}</Tag> })),
      ...Object.entries(document.notification_defaults).map(([key, value]) => ({ key: `notify-${key}`, label: key, children: String(value) })),
    ]} /></Card>
    <Card title="AI 场景路由与预算"><Table rowKey="key" pagination={false} dataSource={document.scenes} columns={[
      { title: "Scene", dataIndex: "key" }, { title: "Model", dataIndex: "model_alias" },
      { title: "Prompt / Schema", render: (_, row) => `${row.prompt_version} / ${row.schema_version}` },
      { title: "Timeout", dataIndex: "timeout_ms" }, { title: "Context", dataIndex: "max_context_tokens" },
      { title: "Cost cap (USD)", dataIndex: "max_estimated_cost_usd" }, { title: "Fallback", dataIndex: "fallback" },
    ]} /></Card>
    <Card title="AI 路由配置版本"><Table rowKey="revision" pagination={false} dataSource={routing?.revisions ?? []} columns={[
      { title: "Revision", dataIndex: "revision", render: value => `R${value}` },
      { title: "Description", dataIndex: "desc" }, { title: "Created", dataIndex: "createdAt" },
      { title: "State", render: (_, row) => <Tag color={row.revision === routing?.revision ? "green" : "default"}>{row.revision === routing?.revision ? "Current" : "Rollback target"}</Tag> },
    ]} /><p>配置由版本化存储管理；更新与回滚接口要求管理员会话及二次敏感操作授权。</p></Card>
  </section>;
}

import { Button, Card, Form, Input, InputNumber, Modal, Space, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type { AdminSensitiveOperationGrantDocument, BodyLogHabitTemplate } from "../lib/types";

export default function BodyLogHabitTemplatesRoute() {
  const { selectedAppId, setNotice, completeWorkspaceTransition } = useAdminSession();
  const [templates, setTemplates] = useState<BodyLogHabitTemplate[]>([]);
  const [editing, setEditing] = useState<BodyLogHabitTemplate | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sensitiveOpen, setSensitiveOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [form] = Form.useForm();

  async function load() {
    try { setTemplates((await adminApi.listBodyLogHabitTemplates()).items); }
    catch (error) { setNotice(makeNotice("error", formatApiError(error))); }
    finally { completeWorkspaceTransition(); }
  }

  useEffect(() => {
    if (selectedAppId !== "bodylog") { setTemplates([]); completeWorkspaceTransition(); return; }
    void load();
  }, [selectedAppId]);

  function authorize(action: () => Promise<void>) {
    setPendingAction(() => action);
    setSensitiveOpen(true);
  }

  async function save(values: Record<string, unknown>) {
    const input = {
      templateKey: values.templateKey as string,
      category: values.category as string,
      names: { "zh-CN": values.nameZh as string, "en-US": values.nameEn as string },
      icon: (values.icon as string) || null,
      defaultTargetCount: Number(values.defaultTargetCount ?? 1),
      sortOrder: Number(values.sortOrder ?? 0),
    };
    authorize(async () => {
      if (editing) await adminApi.updateBodyLogHabitTemplate(editing.id, input);
      else await adminApi.createBodyLogHabitTemplate(input);
      setModalOpen(false);
      await load();
    });
  }

  if (selectedAppId !== "bodylog") return <section className="empty-state">请先切换到 BodyLog 项目空间。</section>;
  return <section className="stack">
    <header className="page-header"><div><h1>习惯模板</h1><p>维护 BodyLog 预置习惯。写操作需要二次授权。</p></div><Button type="primary" onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>新建模板</Button></header>
    <Card><Table rowKey="id" dataSource={templates} pagination={false} columns={[
      { title: "Key", dataIndex: "templateKey" }, { title: "中文名称", render: (_, row) => row.names["zh-CN"] }, { title: "English", render: (_, row) => row.names["en-US"] },
      { title: "分类", dataIndex: "category" }, { title: "目标次数", dataIndex: "defaultTargetCount" }, { title: "状态", dataIndex: "status", render: value => <Tag>{value}</Tag> },
      { title: "操作", render: (_, row) => <Space><Button onClick={() => { setEditing(row); form.setFieldsValue({ templateKey: row.templateKey, category: row.category, nameZh: row.names["zh-CN"], nameEn: row.names["en-US"], icon: row.icon, defaultTargetCount: row.defaultTargetCount, sortOrder: row.sortOrder }); setModalOpen(true); }}>编辑</Button><Button danger onClick={() => authorize(async () => { await adminApi.deleteBodyLogHabitTemplate(row.id); await load(); })}>归档</Button></Space> },
    ]} /></Card>
    <Modal title={editing ? "编辑习惯模板" : "新建习惯模板"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save} initialValues={{ defaultTargetCount: 1, sortOrder: 0, category: "general" }}>
        <Form.Item name="templateKey" label="Template key" rules={[{ required: true }]}><Input disabled={Boolean(editing)} /></Form.Item>
        <Form.Item name="category" label="分类" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="nameZh" label="中文名称" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="nameEn" label="English name" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="icon" label="图标"><Input /></Form.Item>
        <Form.Item name="defaultTargetCount" label="目标次数"><InputNumber min={1} /></Form.Item>
        <Form.Item name="sortOrder" label="排序"><InputNumber min={0} /></Form.Item>
        <Button type="primary" htmlType="submit">保存</Button>
      </Form>
    </Modal>
    <SensitiveOperationModal open={sensitiveOpen} operation="bodylog.habit-templates.write" title="授权修改习惯模板" description="请输入二次授权验证码。" onClose={() => setSensitiveOpen(false)} onAuthorized={async (_grant: AdminSensitiveOperationGrantDocument) => { if (pendingAction) await pendingAction(); }} />
  </section>;
}

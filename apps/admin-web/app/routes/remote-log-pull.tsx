import { PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, InputNumber, Space, Switch, Table, Tag, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";

import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminRemoteLogPullSettingsDocument,
  AdminRemoteLogPullTaskListDocument,
  RemoteLogPullSettings,
} from "../lib/types";

export default function RemoteLogPullRoute() {
  const {
    apps,
    selectedAppId,
    reloadBootstrap,
    setNotice,
    clearNotice,
    completeWorkspaceTransition,
  } = useAdminSession();
  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  const [document, setDocument] = useState<AdminRemoteLogPullSettingsDocument | null>(null);
  const [tasks, setTasks] = useState<AdminRemoteLogPullTaskListDocument | null>(null);
  const [config, setConfig] = useState<RemoteLogPullSettings | null>(null);
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [taskForm] = Form.useForm<{ userId: string; clientId: string }>();

  async function loadLatest() {
    if (!selectedAppId) {
      setDocument(null);
      setTasks(null);
      setConfig(null);
      setDesc("");
      completeWorkspaceTransition();
      return;
    }

    setLoading(true);
    try {
      const [settingsPayload, tasksPayload] = await Promise.all([
        adminApi.getRemoteLogPull(selectedAppId),
        adminApi.listRemoteLogPullTasks(selectedAppId),
      ]);
      setDocument(settingsPayload);
      setConfig(settingsPayload.config);
      setTasks(tasksPayload);
      setDesc("");
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    void loadLatest();
  }, [selectedAppId]);

  async function handleSave() {
    if (!selectedAppId || !config) {
      return;
    }

    setSaving(true);
    clearNotice();
    try {
      const payload = await adminApi.updateRemoteLogPull(selectedAppId, config, desc.trim() || undefined);
      setDocument(payload);
      setConfig(payload.config);
      setDesc("");
      await reloadBootstrap();
      setNotice(makeNotice("success", "Remote Log Pull 设置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setLoading(true);
    try {
      const payload = await adminApi.getRemoteLogPullRevision(selectedAppId, revision);
      setDocument(payload);
      setConfig(payload.config);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRestoreRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setRestoringRevision(revision);
    clearNotice();
    try {
      const payload = await adminApi.restoreRemoteLogPull(selectedAppId, revision);
      setDocument(payload);
      setConfig(payload.config);
      setDesc("");
      setNotice(makeNotice("success", `已恢复到版本 R${revision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleCreateTask() {
    if (!selectedAppId) {
      return;
    }

    const values = await taskForm.validateFields();
    setCreatingTask(true);
    clearNotice();
    try {
      const payload = await adminApi.createRemoteLogPullTask(selectedAppId, values.userId, values.clientId);
      setTasks(payload);
      taskForm.resetFields();
      setNotice(makeNotice("success", "日志回捞任务已创建。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setCreatingTask(false);
    }
  }

  async function handleCancelTask(taskId: string) {
    if (!selectedAppId) {
      return;
    }

    setCancellingTaskId(taskId);
    clearNotice();
    try {
      const payload = await adminApi.cancelRemoteLogPullTask(selectedAppId, taskId);
      setTasks(payload);
      setNotice(makeNotice("success", `任务 ${taskId} 已取消。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setCancellingTaskId(null);
    }
  }

  const taskColumns = useMemo(
    () => [
      {
        title: "UID",
        dataIndex: "userId",
        key: "userId",
      },
      {
        title: "DID / Client ID",
        dataIndex: "clientId",
        key: "clientId",
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        render: (value: string) => <Tag color={value === "COMPLETED" ? "green" : value === "CANCELLED" ? "red" : value === "CLAIMED" ? "blue" : "default"}>{value}</Tag>,
      },
      {
        title: "窗口",
        key: "window",
        render: (_: unknown, record: NonNullable<typeof tasks>["items"][number]) =>
          `${record.fromTsMs ?? "—"} ~ ${record.toTsMs ?? "—"}`,
      },
      {
        title: "Claim 到期",
        dataIndex: "claimExpireAt",
        key: "claimExpireAt",
        render: (value?: string) => formatTimestamp(value),
      },
      {
        title: "创建于",
        dataIndex: "createdAt",
        key: "createdAt",
        render: (value: string) => formatTimestamp(value),
      },
      {
        title: "操作",
        key: "actions",
        render: (_: unknown, record: NonNullable<typeof tasks>["items"][number]) =>
          record.status === "PENDING" || record.status === "CLAIMED" ? (
            <Tooltip title="取消任务">
              <span>
                <Button
                  danger
                  icon={<StopOutlined />}
                  loading={cancellingTaskId === record.taskId}
                  onClick={() => void handleCancelTask(record.taskId)}
                  shape="circle"
                  type="default"
                />
              </span>
            </Tooltip>
          ) : null,
      },
    ],
    [tasks, cancellingTaskId],
  );

  if (!selectedApp) {
    return (
      <section className="empty-state">
        请先在“应用管理”中创建或选择一个 App，再进入 `Remote Log Pull`。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>Remote Log Pull</h1>
          <p>当前项目空间为 {selectedApp.appName}。这里单独管理当前 App 的日志回捞设置和任务。</p>
        </div>
      </header>

      <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
        <div className="stack">
          <Card
            extra={(
              <Space>
                <span className="meta-chip">{document?.revision ? `R${document.revision}` : "默认值"}</span>
                <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
                <Button icon={<ReloadOutlined />} onClick={() => void loadLatest()} type="default">
                  刷新
                </Button>
              </Space>
            )}
            title="Settings"
          >
            <div className="stack">
              <Alert
                message="通用策略放在这里维护，真正创建任务时只需要填 UID 和 DID / Client ID。"
                showIcon
                type="info"
              />

              {config ? (
                <Form layout="vertical">
                  <Form.Item label="Enabled">
                    <Switch
                      checked={config.enabled}
                      onChange={(checked) => setConfig({ ...config, enabled: checked })}
                    />
                  </Form.Item>

                  <Form.Item label="Min Pull Interval Seconds">
                    <InputNumber
                      min={1}
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          minPullIntervalSeconds: Number(value ?? 1),
                        })}
                      style={{ width: "100%" }}
                      value={config.minPullIntervalSeconds}
                    />
                  </Form.Item>

                  <Form.Item label="Claim TTL Seconds">
                    <InputNumber
                      min={1}
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          claimTtlSeconds: Number(value ?? 1),
                        })}
                      style={{ width: "100%" }}
                      value={config.claimTtlSeconds}
                    />
                  </Form.Item>

                  <Form.Item label="Default Lookback Minutes">
                    <InputNumber
                      min={1}
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          taskDefaults: {
                            ...config.taskDefaults,
                            lookbackMinutes: Number(value ?? 1),
                          },
                        })}
                      style={{ width: "100%" }}
                      value={config.taskDefaults.lookbackMinutes}
                    />
                  </Form.Item>

                  <Form.Item label="Default Max Lines">
                    <InputNumber
                      min={1}
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          taskDefaults: {
                            ...config.taskDefaults,
                            maxLines: Number(value ?? 1),
                          },
                        })}
                      style={{ width: "100%" }}
                      value={config.taskDefaults.maxLines}
                    />
                  </Form.Item>

                  <Form.Item label="Default Max Bytes">
                    <InputNumber
                      min={1}
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          taskDefaults: {
                            ...config.taskDefaults,
                            maxBytes: Number(value ?? 1),
                          },
                        })}
                      style={{ width: "100%" }}
                      value={config.taskDefaults.maxBytes}
                    />
                  </Form.Item>

                  <Form.Item label="Revision Desc">
                    <Input
                      onChange={(event) => setDesc(event.target.value)}
                      placeholder="例如：调高 claim TTL，默认回看最近 120 分钟"
                      value={desc}
                    />
                  </Form.Item>

                  <div className="button-row">
                    <Button loading={saving} onClick={() => void handleSave()} type="primary">
                      保存设置
                    </Button>
                  </div>
                </Form>
              ) : null}
            </div>
          </Card>

          <Card title="Create Task">
            <div className="stack">
              <Alert
                message={`任务会自动使用当前设置里的默认窗口和限额，也会自动绑定当前 App 的 keyId。`}
                showIcon
                type="info"
              />

              <Form form={taskForm} layout="vertical">
                <Form.Item label="UID" name="userId" rules={[{ required: true, message: "请输入 userId" }]}>
                  <Input placeholder="user_alice" />
                </Form.Item>
                <Form.Item label="DID / Client ID" name="clientId" rules={[{ required: true, message: "请输入 DID / Client ID" }]}>
                  <Input placeholder="did_ios_001 / web_install_001" />
                </Form.Item>
                <div className="button-row">
                  <Button icon={<PlusOutlined />} loading={creatingTask} onClick={() => void handleCreateTask()} type="primary">
                    创建回捞任务
                  </Button>
                </div>
              </Form>
            </div>
          </Card>

          <Card title="Task List">
            <Table
              columns={taskColumns}
              dataSource={tasks?.items ?? []}
              pagination={{ pageSize: 8 }}
              rowKey="taskId"
              scroll={{ x: 1200 }}
            />
          </Card>
        </div>

        <RevisionHistoryDock expanded={historyExpanded} onToggle={() => setHistoryExpanded((current) => !current)}>
          <RevisionList
            activeRevision={document?.revision}
            compact
            loadingRevision={restoringRevision}
            onRestore={(revision) => void handleRestoreRevision(revision)}
            onSelect={(revision) => void handleViewRevision(revision)}
            revisions={document?.revisions ?? []}
          />
        </RevisionHistoryDock>
      </div>
    </section>
  );
}

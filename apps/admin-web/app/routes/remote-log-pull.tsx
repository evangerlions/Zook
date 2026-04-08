import { InfoCircleOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";

import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { writeClipboard } from "../lib/clipboard";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminRemoteLogPullSettingsDocument,
  AdminRemoteLogPullTaskFileDocument,
  AdminRemoteLogPullTaskListDocument,
  RemoteLogPullSettings,
} from "../lib/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_TASK_SIZE_MEGABYTES = 100;

function bytesToMegabytes(value: number): number {
  return Math.max(1, Math.round(value / BYTES_PER_MEGABYTE));
}

function megabytesToBytes(value: number): number {
  return value * BYTES_PER_MEGABYTE;
}

function downloadTextFile(fileName: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseNdjson(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        return {
          key: `${index}`,
          timestamp: typeof payload.tsMs === "number" ? String(payload.tsMs) : "—",
          level: typeof payload.level === "string" ? payload.level : "—",
          message: typeof payload.message === "string" ? payload.message : line,
          raw: JSON.stringify(payload, null, 2),
        };
      } catch {
        return {
          key: `${index}`,
          timestamp: "—",
          level: "—",
          message: line,
          raw: line,
        };
      }
    });
}

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
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);
  const [taskFile, setTaskFile] = useState<AdminRemoteLogPullTaskFileDocument | null>(null);
  const [failureTask, setFailureTask] = useState<NonNullable<typeof tasks>["items"][number] | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const [tab, setTab] = useState<"settings" | "tasks">("settings");
  const [taskForm] = Form.useForm<{ userId: string; did: string }>();
  const settingsTabActive = tab === "settings";

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

  async function handleRequestRestoreRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setRestoringRevision(revision);
    clearNotice();
    try {
      const [latestPayload, revisionPayload] = await Promise.all([
        adminApi.getRemoteLogPull(selectedAppId),
        adminApi.getRemoteLogPullRevision(selectedAppId, revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(JSON.stringify(latestPayload.config, null, 2));
      setRestoreNewValue(JSON.stringify(revisionPayload.config, null, 2));
      setRestoreDesc(`回滚到版本 R${revision}`);
      setRestoreModalOpen(true);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleConfirmRestoreRevision() {
    if (!selectedAppId || !restoreRevision) {
      return;
    }

    setRestoringRevision(restoreRevision);
    clearNotice();
    try {
      const payload = await adminApi.restoreRemoteLogPull(selectedAppId, restoreRevision, restoreDesc.trim() || undefined);
      setDocument(payload);
      setConfig(payload.config);
      setDesc("");
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      setNotice(makeNotice("success", `已恢复到版本 R${restoreRevision}。`));
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
      const payload = await adminApi.createRemoteLogPullTask(selectedAppId, values.userId, values.did);
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

  async function handleViewTaskFile(taskId: string) {
    if (!selectedAppId) {
      return;
    }

    setViewingTaskId(taskId);
    clearNotice();
    try {
      const payload = await adminApi.getRemoteLogPullTaskFile(selectedAppId, taskId);
      setTaskFile(payload);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setViewingTaskId(null);
    }
  }

  async function copyTaskValue(kind: "UID" | "DID", value: string) {
    try {
      await writeClipboard(value);
      setNotice(makeNotice("success", `已复制 ${kind}：${value}`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    }
  }

  const parsedTaskLines = useMemo(
    () => (taskFile ? parseNdjson(taskFile.content) : []),
    [taskFile],
  );

  const taskColumns = useMemo(
    () => [
      {
        title: "UID",
        dataIndex: "userId",
        key: "userId",
        width: 120,
        ellipsis: true,
        render: (value: string, record: NonNullable<typeof tasks>["items"][number]) => (
          <Button
            className="inline-link-button"
            onClick={() => void copyTaskValue("UID", record.userId)}
            type="link"
          >
            {value}
          </Button>
        ),
      },
      {
        title: "DID",
        dataIndex: "did",
        key: "did",
        width: 150,
        ellipsis: true,
        render: (value: string, record: NonNullable<typeof tasks>["items"][number]) => (
          <Button
            className="inline-link-button mono"
            onClick={() => void copyTaskValue("DID", record.did)}
            type="link"
          >
            {value}
          </Button>
        ),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 96,
        render: (value: string, record: NonNullable<typeof tasks>["items"][number]) => (
          <Space size={6}>
            <Tag color={value === "COMPLETED" ? "green" : value === "FAILED" ? "volcano" : value === "CANCELLED" ? "red" : value === "CLAIMED" ? "blue" : "default"}>
              {value}
            </Tag>
            {value === "FAILED" && record.failureReason ? (
              <Tooltip title="查看失败详情">
                <Button
                  aria-label="查看失败详情"
                  icon={<InfoCircleOutlined />}
                  onClick={() => setFailureTask(record)}
                  shape="circle"
                  size="small"
                  type="text"
                />
              </Tooltip>
            ) : null}
          </Space>
        ),
      },
      {
        title: "窗口",
        key: "window",
        width: 160,
        render: (_: unknown, record: NonNullable<typeof tasks>["items"][number]) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <span className="mono table-code">{record.fromTsMs ?? "—"}</span>
            <span className="mono table-code">{record.toTsMs ?? "—"}</span>
          </div>
        ),
      },
      {
        title: "时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 180,
        render: (_: string, record: NonNullable<typeof tasks>["items"][number]) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <span>{formatTimestamp(record.createdAt)}</span>
            <span className="meta-text">Claim: {record.claimExpireAt ? formatTimestamp(record.claimExpireAt) : "—"}</span>
            <span className="meta-text">上传: {record.uploadedAt ? formatTimestamp(record.uploadedAt) : "—"}</span>
            <span className="meta-text">失败: {record.failedAt ? formatTimestamp(record.failedAt) : "—"}</span>
          </div>
        ),
      },
      {
        title: "文件",
        key: "file",
        width: 220,
        render: (_: unknown, record: NonNullable<typeof tasks>["items"][number]) =>
          record.uploadedFileName ? (
            <div className="table-primary-cell table-primary-cell--stack">
              <span className="mono">{record.uploadedFileName}</span>
              <span className="meta-text">
                {record.uploadedLineCount ?? 0} lines / {record.uploadedFileSizeBytes ?? 0} bytes
              </span>
            </div>
          ) : "—",
      },
      {
        title: "操作",
        key: "actions",
        width: 150,
        render: (_: unknown, record: NonNullable<typeof tasks>["items"][number]) => (
          <Space>
            {record.uploadedFileName ? (
              <Button
                loading={viewingTaskId === record.taskId}
                onClick={() => void handleViewTaskFile(record.taskId)}
                type="link"
              >
                查看日志
              </Button>
            ) : null}
            {record.status === "PENDING" || record.status === "CLAIMED" ? (
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
            ) : null}
          </Space>
        ),
      },
    ],
    [tasks, cancellingTaskId, viewingTaskId],
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

      <div className={`page-grid page-grid--config${!settingsTabActive || !historyExpanded ? " is-history-collapsed" : ""}`}>
        <div className={`stack remote-log-pull-main-stack${settingsTabActive ? "" : " is-tasks-tab"}`}>
          <Card
            extra={settingsTabActive ? (
              <Space>
                <span className="meta-chip">{document?.revision ? `R${document.revision}` : "默认值"}</span>
                <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
                <Button icon={<ReloadOutlined />} onClick={() => void loadLatest()} type="default">
                  刷新
                </Button>
              </Space>
            ) : (
              <Button icon={<ReloadOutlined />} onClick={() => void loadLatest()} type="default">
                刷新
              </Button>
            )}
            title={settingsTabActive ? "Settings" : "Remote Log Pull"}
          >
            <Tabs
              activeKey={tab}
              className="remote-log-pull-tabs"
              items={[
                {
                  key: "settings",
                  label: "通用设置",
                  children: (
                    <div className="stack">
                      <Alert
                        message="通用策略放在这里维护，创建任务时会自动带入默认窗口、行数和体积限制。"
                        showIcon
                        type="info"
                      />

                      {config ? (
                        <Form layout="vertical">
                          <Form.Item extra="打开后，客户端才能主动拉取日志回捞任务。" label="Enabled">
                            <Switch
                              checked={config.enabled}
                              onChange={(checked) => setConfig({ ...config, enabled: checked })}
                            />
                          </Form.Item>

                          <Form.Item extra="同一个客户端两次拉取任务之间至少要间隔多少秒。" label="Min Pull Interval Seconds">
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

                          <Form.Item extra="任务被客户端领取后，多久内未上传会自动失效。" label="Claim TTL Seconds">
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

                          <Form.Item extra="创建任务时默认向前回看多少分钟的日志窗口。" label="Default Lookback Minutes">
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

                          <Form.Item extra="每个任务默认最多允许上传多少行日志。" label="Default Max Lines">
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

                          <Form.Item extra="每个任务默认最多允许上传多少 M 的压缩日志数据，最大 100M。" label="Default Max Size">
                            <div className="unit-input-row">
                              <InputNumber
                                max={MAX_TASK_SIZE_MEGABYTES}
                                min={1}
                                onChange={(value) =>
                                  setConfig({
                                    ...config,
                                    taskDefaults: {
                                      ...config.taskDefaults,
                                      maxBytes: megabytesToBytes(Number(value ?? 1)),
                                    },
                                  })}
                                parser={(value) => Number(String(value ?? "").replace(/[^\d]/g, "") || 0)}
                                precision={0}
                                style={{ width: "100%" }}
                                value={bytesToMegabytes(config.taskDefaults.maxBytes)}
                              />
                              <span className="unit-input-suffix">M</span>
                            </div>
                          </Form.Item>

                          <Form.Item extra="保存这次设置修改时的备注，方便后面看版本历史。" label="Revision Desc">
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
                  ),
                },
                {
                  key: "tasks",
                  label: "任务管理",
                  children: (
                    <div className="stack remote-log-pull-task-pane">
                      <Card className="table-card" title="Create Task">
                        <div className="stack">
                          <Alert
                            message="这里只需要填写 UID 和 DID，任务会自动继承当前通用设置里的默认窗口和限额。"
                            showIcon
                            type="info"
                          />

                          <Form form={taskForm} layout="vertical">
                            <Form.Item extra="要回捞哪个用户的日志，就填这个用户的 userId。" label="UID" name="userId" rules={[{ required: true, message: "请输入 userId" }]}>
                              <Input placeholder="user_alice" />
                            </Form.Item>
                            <Form.Item extra="客户端设备标识，用来精确定位具体终端。" label="DID" name="did" rules={[{ required: true, message: "请输入 DID" }]}>
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

                      <Card className="table-card" title="Task List">
                        <div className="table-wrap">
                          <Table
                            columns={taskColumns}
                            dataSource={tasks?.items ?? []}
                            pagination={{ pageSize: 8 }}
                            rowKey="taskId"
                            size="small"
                          />
                        </div>
                      </Card>
                    </div>
                  ),
                },
              ]}
              onChange={(value) => setTab(value as "settings" | "tasks")}
            />
          </Card>
        </div>

        {settingsTabActive ? (
          <RevisionHistoryDock expanded={historyExpanded} onToggle={() => setHistoryExpanded((current) => !current)}>
            <RevisionList
              activeRevision={document?.revision}
              compact
              latestRevision={document?.revisions?.[0]?.revision}
              loadingRevision={restoringRevision}
              onRestore={(revision) => void handleRequestRestoreRevision(revision)}
              onSelect={(revision) => void handleViewRevision(revision)}
              revisions={document?.revisions ?? []}
            />
          </RevisionHistoryDock>
        ) : (
          <aside aria-hidden="true" className="side-card side-card--history history-dock-placeholder" />
        )}
      </div>
      <SaveConfirmModal
        desc={restoreDesc}
        descPlaceholder="例如：误修改后回滚到稳定版本"
        loading={Boolean(restoreRevision) && restoringRevision === restoreRevision}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        onCancel={() => {
          setRestoreModalOpen(false);
          setRestoreRevision(null);
          setRestoreDesc("");
        }}
        onConfirm={() => void handleConfirmRestoreRevision()}
        onDescChange={setRestoreDesc}
        okText="确认回滚"
        open={restoreModalOpen}
        title={restoreRevision ? `确认回滚到版本 R${restoreRevision}` : "确认回滚"}
        autoGenerateDesc={false}
      />
      <Modal
        footer={(
          <Button onClick={() => setFailureTask(null)} type="primary">
            关闭
          </Button>
        )}
        onCancel={() => setFailureTask(null)}
        open={Boolean(failureTask)}
        title={failureTask ? `失败详情 · ${failureTask.taskId}` : "失败详情"}
        width={760}
      >
        {failureTask ? (
          <div className="stack">
            <Alert
              message="这里展示客户端最终上报给后端的失败信息。"
              showIcon
              type="warning"
            />
            <pre className="json-preview">{JSON.stringify({
              taskId: failureTask.taskId,
              uid: failureTask.userId,
              did: failureTask.did,
              status: failureTask.status,
              failedAt: failureTask.failedAt ?? null,
              failureReason: failureTask.failureReason ?? null,
            }, null, 2)}</pre>
          </div>
        ) : null}
      </Modal>

      <Modal
        footer={(
          <Space>
            {taskFile ? (
              <Button onClick={() => downloadTextFile(taskFile.fileName, taskFile.content, taskFile.contentType)}>
                下载原始文件
              </Button>
            ) : null}
            <Button onClick={() => setTaskFile(null)} type="primary">
              关闭
            </Button>
          </Space>
        )}
        onCancel={() => setTaskFile(null)}
        open={Boolean(taskFile)}
        title={taskFile ? `日志浏览 · ${taskFile.fileName}` : "日志浏览"}
        width={1100}
      >
        {taskFile ? (
          <div className="stack">
            <Alert
              message={`前端本地解析 ${taskFile.fileName}，共 ${taskFile.lineCount ?? parsedTaskLines.length} 行，${taskFile.sizeBytes} bytes。`}
              showIcon
              type="info"
            />
            <div className="table-wrap">
              <Table
                columns={[
                  { title: "#", dataIndex: "key", key: "key", width: 72 },
                  { title: "时间", dataIndex: "timestamp", key: "timestamp", width: 180 },
                  { title: "级别", dataIndex: "level", key: "level", width: 120 },
                  { title: "消息", dataIndex: "message", key: "message" },
                ]}
                dataSource={parsedTaskLines}
                expandable={{
                  expandedRowRender: (record) => <pre className="json-preview">{record.raw}</pre>,
                }}
                pagination={{ pageSize: 20 }}
                rowKey="key"
                scroll={{ x: 980 }}
                size="small"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

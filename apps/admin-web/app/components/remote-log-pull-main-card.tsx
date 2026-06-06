import { InfoCircleOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, InputNumber, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import type { FormInstance, TableColumnsType } from "antd";
import { useMemo } from "react";
import { useNavigate } from "react-router";

import { formatTimestamp } from "../lib/format";
import type {
  AdminRemoteLogPullSettingsDocument,
  AdminRemoteLogPullTaskListDocument,
  RemoteLogPullSettings,
} from "../lib/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_TASK_SIZE_MEGABYTES = 100;

type RemoteLogPullTabKey = "settings" | "tasks";
type RemoteLogPullTaskItem = AdminRemoteLogPullTaskListDocument["items"][number];
type RemoteLogPullCopyKind = "Task ID" | "UID" | "DID";

interface RemoteLogPullMainCardProps {
  cancellingTaskId: string | null;
  config: RemoteLogPullSettings | null;
  creatingTask: boolean;
  desc: string;
  document: AdminRemoteLogPullSettingsDocument | null;
  onCancelTask: (taskId: string) => void;
  onConfigChange: (config: RemoteLogPullSettings) => void;
  onCopyTaskValue: (kind: RemoteLogPullCopyKind, value: string) => void;
  onCreateTask: () => void;
  onDescChange: (value: string) => void;
  onFailureTaskOpen: (task: RemoteLogPullTaskItem) => void;
  onRefresh: () => void;
  onSave: () => void;
  onTabChange: (value: RemoteLogPullTabKey) => void;
  saving: boolean;
  tab: RemoteLogPullTabKey;
  taskForm: FormInstance<{ userId: string; did: string }>;
  tasks: AdminRemoteLogPullTaskListDocument | null;
}

function bytesToMegabytes(value: number): number {
  return Math.max(1, Math.round(value / BYTES_PER_MEGABYTE));
}

function megabytesToBytes(value: number): number {
  return value * BYTES_PER_MEGABYTE;
}

export function RemoteLogPullMainCard({
  cancellingTaskId,
  config,
  creatingTask,
  desc,
  document,
  onCancelTask,
  onConfigChange,
  onCopyTaskValue,
  onCreateTask,
  onDescChange,
  onFailureTaskOpen,
  onRefresh,
  onSave,
  onTabChange,
  saving,
  tab,
  taskForm,
  tasks,
}: RemoteLogPullMainCardProps) {
  const navigate = useNavigate();
  const settingsTabActive = tab === "settings";
  const taskColumns = useMemo<TableColumnsType<RemoteLogPullTaskItem>>(
    () => [
      {
        title: "Task ID",
        dataIndex: "taskId",
        key: "taskId",
        width: 150,
        ellipsis: true,
        render: (value: string) => (
          <Tooltip title={value}>
            <Button
              className="inline-link-button is-ellipsis mono"
              onClick={() => onCopyTaskValue("Task ID", value)}
              type="link"
            >
              {value}
            </Button>
          </Tooltip>
        ),
      },
      {
        title: "UID",
        dataIndex: "userId",
        key: "userId",
        width: 120,
        ellipsis: true,
        render: (value: string, record: RemoteLogPullTaskItem) => (
          <Button
            className="inline-link-button"
            onClick={() => onCopyTaskValue("UID", record.userId)}
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
        render: (value: string, record: RemoteLogPullTaskItem) => (
          <Button
            className="inline-link-button mono"
            onClick={() => onCopyTaskValue("DID", record.did)}
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
        render: (value: string, record: RemoteLogPullTaskItem) => (
          <Space size={6}>
            <Tag color={value === "COMPLETED" ? "green" : value === "FAILED" ? "volcano" : value === "CANCELLED" ? "red" : value === "CLAIMED" ? "blue" : "default"}>
              {value}
            </Tag>
            {value === "FAILED" && record.failureReason ? (
              <Tooltip title="查看失败详情">
                <Button
                  aria-label="查看失败详情"
                  icon={<InfoCircleOutlined />}
                  onClick={() => onFailureTaskOpen(record)}
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
        render: (_: unknown, record: RemoteLogPullTaskItem) => (
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
        render: (_: string, record: RemoteLogPullTaskItem) => (
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
        render: (_: unknown, record: RemoteLogPullTaskItem) =>
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
        render: (_: unknown, record: RemoteLogPullTaskItem) => (
          <Space>
            {record.uploadedFileName ? (
              <Button
                onClick={() => void navigate(`/remote-log-pull/tasks/${encodeURIComponent(record.taskId)}`)}
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
                    onClick={() => onCancelTask(record.taskId)}
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
    [cancellingTaskId, navigate, onCancelTask, onCopyTaskValue, onFailureTaskOpen],
  );

  return (
    <Card
      extra={settingsTabActive ? (
        <Space>
          <span className="meta-chip">{document?.revision ? `R${document.revision}` : "默认值"}</span>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} type="default">
            刷新
          </Button>
        </Space>
      ) : (
        <Button icon={<ReloadOutlined />} onClick={onRefresh} type="default">
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
              <RemoteLogPullSettingsForm
                config={config}
                desc={desc}
                onConfigChange={onConfigChange}
                onDescChange={onDescChange}
                onSave={onSave}
                saving={saving}
              />
            ),
          },
          {
            key: "tasks",
            label: "任务管理",
            children: (
              <RemoteLogPullTaskPane
                columns={taskColumns}
                creatingTask={creatingTask}
                onCreateTask={onCreateTask}
                taskForm={taskForm}
                tasks={tasks}
              />
            ),
          },
        ]}
        onChange={(value) => onTabChange(value as RemoteLogPullTabKey)}
      />
    </Card>
  );
}

function RemoteLogPullSettingsForm({
  config,
  desc,
  onConfigChange,
  onDescChange,
  onSave,
  saving,
}: Pick<RemoteLogPullMainCardProps, "config" | "desc" | "onConfigChange" | "onDescChange" | "onSave" | "saving">) {
  if (!config) {
    return null;
  }

  return (
    <div className="stack">
      <Alert
        message="通用策略放在这里维护，创建任务时会自动带入默认窗口、行数和体积限制。"
        showIcon
        type="info"
      />

      <Form layout="vertical">
        <Form.Item extra="打开后，客户端才能主动拉取日志回捞任务。" label="Enabled">
          <Switch
            checked={config.enabled}
            onChange={(checked) => onConfigChange({ ...config, enabled: checked })}
          />
        </Form.Item>

        <Form.Item extra="同一个客户端两次拉取任务之间至少要间隔多少秒。" label="Min Pull Interval Seconds">
          <InputNumber
            min={1}
            onChange={(value) =>
              onConfigChange({
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
              onConfigChange({
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
              onConfigChange({
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
              onConfigChange({
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
                onConfigChange({
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
            onChange={(event) => onDescChange(event.target.value)}
            placeholder="例如：调高 claim TTL，默认回看最近 120 分钟"
            value={desc}
          />
        </Form.Item>

        <div className="button-row">
          <Button loading={saving} onClick={onSave} type="primary">
            保存设置
          </Button>
        </div>
      </Form>
    </div>
  );
}

function RemoteLogPullTaskPane({
  columns,
  creatingTask,
  onCreateTask,
  taskForm,
  tasks,
}: Pick<RemoteLogPullMainCardProps, "creatingTask" | "onCreateTask" | "taskForm" | "tasks"> & {
  columns: TableColumnsType<RemoteLogPullTaskItem>;
}) {
  return (
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
              <Button icon={<PlusOutlined />} loading={creatingTask} onClick={onCreateTask} type="primary">
                创建回捞任务
              </Button>
            </div>
          </Form>
        </div>
      </Card>

      <Card className="table-card" title="Task List">
        <div className="table-wrap">
          <Table
            columns={columns}
            dataSource={tasks?.items ?? []}
            pagination={{ pageSize: 8 }}
            rowKey="taskId"
            size="small"
          />
        </div>
      </Card>
    </div>
  );
}

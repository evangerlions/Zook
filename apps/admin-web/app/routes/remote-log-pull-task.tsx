import { ArrowLeftOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, Input, Select, Space, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { JsonPreview } from "../components/json-preview";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { writeClipboard } from "../lib/clipboard";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type { AdminRemoteLogPullTaskDocument, AdminRemoteLogPullTaskFileDocument } from "../lib/types";

type ParsedLogLine = {
  key: string;
  lineNo: number;
  timestamp: string;
  level: string;
  module: string;
  message: string;
  raw: string;
};

function formatLogTimestamp(value: string) {
  if (!value || value === "—") {
    return "—";
  }

  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatLogMessage(payload: Record<string, unknown>, fallback: string) {
  const parts: string[] = [];
  const baseMessage = typeof payload.message === "string" ? payload.message : fallback;
  if (baseMessage) {
    parts.push(baseMessage);
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    parts.push(`error: ${payload.error.trim()}`);
  }

  if (typeof payload.stackTrace === "string" && payload.stackTrace.trim()) {
    parts.push(`stackTrace: ${payload.stackTrace.trim()}`);
  }

  if (payload.context !== undefined) {
    try {
      parts.push(`context: ${typeof payload.context === "string" ? payload.context : JSON.stringify(payload.context)}`);
    } catch {
      parts.push(`context: ${String(payload.context)}`);
    }
  }

  return parts.join("\n");
}

function parseNdjson(content: string): ParsedLogLine[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        return {
          key: `${index}`,
          lineNo: index + 1,
          timestamp: typeof payload.tsMs === "number" ? String(payload.tsMs) : "—",
          level: typeof payload.level === "string" ? payload.level : "unknown",
          module: typeof payload.module === "string" ? payload.module : "—",
          message: formatLogMessage(payload, line),
          raw: JSON.stringify(payload, null, 2),
        };
      } catch {
        return {
          key: `${index}`,
          lineNo: index + 1,
          timestamp: "—",
          level: "unknown",
          module: "—",
          message: line,
          raw: line,
        };
      }
    });
}

function levelTagColor(level: string) {
  const normalized = level.trim().toLowerCase();
  if (normalized === "info") return "processing";
  if (normalized === "warn" || normalized === "warning") return "warning";
  if (normalized === "error") return "error";
  return "default";
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

export default function RemoteLogPullTaskRoute() {
  const navigate = useNavigate();
  const { taskId = "" } = useParams();
  const {
    selectedAppId,
    setNotice,
    clearNotice,
    completeWorkspaceTransition,
  } = useAdminSession();
  const [loading, setLoading] = useState(false);
  const [document, setDocument] = useState<AdminRemoteLogPullTaskDocument | null>(null);
  const [taskFile, setTaskFile] = useState<AdminRemoteLogPullTaskFileDocument | null>(null);
  const [keyword, setKeyword] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number>(20);

  useEffect(() => {
    async function load() {
      if (!selectedAppId || !taskId) {
        completeWorkspaceTransition();
        return;
      }

      setLoading(true);
      clearNotice();
      try {
        const taskPayload = await adminApi.getRemoteLogPullTask(selectedAppId, taskId);
        setDocument(taskPayload);
        if (taskPayload.item.uploadedFileName) {
          const filePayload = await adminApi.getRemoteLogPullTaskFile(selectedAppId, taskId);
          setTaskFile(filePayload);
        } else {
          setTaskFile(null);
        }
      } catch (error) {
        setNotice(makeNotice("error", formatApiError(error)));
      } finally {
        setLoading(false);
        completeWorkspaceTransition();
      }
    }

    void load();
  }, [selectedAppId, taskId]);

  const parsedLines = useMemo(
    () => (taskFile ? parseNdjson(taskFile.content) : []),
    [taskFile],
  );

  const filteredLines = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return parsedLines.filter((item) => {
      if (levelFilter !== "all" && item.level.toLowerCase() !== levelFilter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return item.message.toLowerCase().includes(normalizedKeyword) || item.raw.toLowerCase().includes(normalizedKeyword);
    });
  }, [parsedLines, keyword, levelFilter]);

  const levelOptions = useMemo(() => {
    const values = Array.from(new Set(parsedLines.map((item) => item.level.toLowerCase()).filter(Boolean))).sort();
    return [{ label: "全部级别", value: "all" }, ...values.map((value) => ({ label: value, value }))];
  }, [parsedLines]);

  async function copyValue(label: string, value: string) {
    try {
      await writeClipboard(value);
      setNotice(makeNotice("success", `已复制 ${label}：${value}`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>Remote Log Task</h1>
          <p>查看当前日志回捞任务的摘要信息与上传后的日志文件内容。</p>
        </div>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/remote-log-pull")}>
            返回任务列表
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => window.location.reload()}>
            刷新
          </Button>
        </Space>
      </header>

      {document ? (
        <Card title="Task Summary">
          <Descriptions column={2} size="small">
            <Descriptions.Item label="Task ID">{document.item.taskId}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={document.item.status === "COMPLETED" ? "green" : document.item.status === "FAILED" ? "volcano" : document.item.status === "CLAIMED" ? "blue" : document.item.status === "CANCELLED" ? "red" : "default"}>
                {document.item.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="UID">
              <Button onClick={() => void copyValue("UID", document.item.userId)} type="link">
                {document.item.userId}
              </Button>
            </Descriptions.Item>
            <Descriptions.Item label="DID">
              <Button onClick={() => void copyValue("DID", document.item.did)} type="link">
                {document.item.did}
              </Button>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatTimestamp(document.item.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="上传时间">{document.item.uploadedAt ? formatTimestamp(document.item.uploadedAt) : "—"}</Descriptions.Item>
            <Descriptions.Item label="失败时间">{document.item.failedAt ? formatTimestamp(document.item.failedAt) : "—"}</Descriptions.Item>
            <Descriptions.Item label="Claim 到期">{document.item.claimExpireAt ? formatTimestamp(document.item.claimExpireAt) : "—"}</Descriptions.Item>
            <Descriptions.Item label="窗口">{`${document.item.fromTsMs ?? "—"} ~ ${document.item.toTsMs ?? "—"}`}</Descriptions.Item>
            <Descriptions.Item label="失败原因" span={2}>
              {document.item.failureReason ? <JsonPreview value={document.item.failureReason} /> : "—"}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      <Card
        extra={taskFile ? (
          <Button
            icon={<DownloadOutlined />}
            onClick={() => downloadTextFile(taskFile.fileName, taskFile.content, taskFile.contentType)}
          >
            下载原始文件
          </Button>
        ) : null}
        title="File Summary"
      >
        {taskFile ? (
          <Descriptions column={2} size="small">
            <Descriptions.Item label="文件名">{taskFile.fileName}</Descriptions.Item>
            <Descriptions.Item label="Content-Type">{taskFile.contentType}</Descriptions.Item>
            <Descriptions.Item label="大小">{taskFile.sizeBytes} bytes</Descriptions.Item>
            <Descriptions.Item label="行数">{taskFile.lineCount ?? parsedLines.length}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Empty description="任务尚未生成日志文件" />
        )}
      </Card>

      <Card title="Log Viewer">
        {taskFile ? (
          <div className="stack">
            <Alert
              message={`前端本地解析 ${taskFile.fileName}，共 ${taskFile.lineCount ?? parsedLines.length} 行。`}
              showIcon
              type="info"
            />
            <div className="top-actions">
              <Input
                allowClear
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索 message 或原始 JSON"
                value={keyword}
              />
              <Select
                onChange={(value) => setLevelFilter(value)}
                options={levelOptions}
                value={levelFilter}
                style={{ width: 180 }}
              />
              <Select
                onChange={(value) => setPageSize(value)}
                options={[
                  { label: "20 / 页", value: 20 },
                  { label: "50 / 页", value: 50 },
                  { label: "100 / 页", value: 100 },
                ]}
                value={pageSize}
                style={{ width: 140 }}
              />
              <Button
                onClick={() => {
                  setKeyword("");
                  setLevelFilter("all");
                  setPageSize(20);
                }}
                type="default"
              >
                清空筛选
              </Button>
            </div>
            <div className="table-wrap">
              <Table
                columns={[
                  { title: "#", dataIndex: "lineNo", key: "lineNo", width: 72 },
                  {
                    title: "时间",
                    dataIndex: "timestamp",
                    key: "timestamp",
                    width: 180,
                    render: (value: string) => formatLogTimestamp(value),
                  },
                  {
                    title: "级别",
                    dataIndex: "level",
                    key: "level",
                    width: 92,
                    render: (value: string) => <Tag color={levelTagColor(value)}>{value}</Tag>,
                  },
                  {
                    title: "模块",
                    dataIndex: "module",
                    key: "module",
                    width: 140,
                    ellipsis: true,
                  },
                  {
                    title: "消息",
                    dataIndex: "message",
                    key: "message",
                    ellipsis: false,
                    render: (value: string) => <div style={{ whiteSpace: "pre-wrap" }}>{value}</div>,
                  },
                ]}
                dataSource={filteredLines}
                expandable={{
                  expandedRowRender: (record) => <JsonPreview value={record.raw} />,
                }}
                locale={{
                  emptyText: keyword || levelFilter !== "all" ? "当前筛选条件下没有日志。" : "日志文件为空。",
                }}
                pagination={{ pageSize }}
                rowKey="key"
                scroll={{ x: 980 }}
                size="small"
              />
            </div>
          </div>
        ) : (
          <Empty description="没有可浏览的日志文件" />
        )}
      </Card>
    </section>
  );
}

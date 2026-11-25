import { Button, Collapse, Descriptions, Drawer, Space, Tag } from "antd";
import { useState } from "react";

import { adminApi } from "../../lib/admin-api";
import { feedbackStatusColor, feedbackStatusLabel, feedbackUserLabel } from "../../lib/feedback";
import { formatTimestamp } from "../../lib/format";
import type { AdminFeedbackItem, FeedbackStatus } from "../../lib/types";
import { JsonPreview } from "../json-preview";
import { FeedbackReplyComposer } from "./feedback-reply-composer";
import { FeedbackThreadMessages } from "./feedback-thread-messages";
import "./feedback-thread.css";

async function downloadLogs(feedback: AdminFeedbackItem) {
  if (!feedback.logTask) return;
  const file = await adminApi.getRemoteLogPullTaskFile("ai_novel", feedback.logTask.taskId);
  const stream = new Blob([file.content], { type: "application/x-ndjson" })
    .stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).blob();
  const url = URL.createObjectURL(compressed);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${feedback.id}.ndjson.gz`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function FeedbackDiagnostics({ item, onError }: { item: AdminFeedbackItem; onError: (error: unknown) => void }) {
  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="UID">{item.userId}</Descriptions.Item>
      <Descriptions.Item label="提交时间">{formatTimestamp(item.createdAt)}</Descriptions.Item>
      <Descriptions.Item label="平台">
        {[item.platform, item.appVersion, item.locale].filter(Boolean).join(" · ") || "—"}
      </Descriptions.Item>
      <Descriptions.Item label="诊断信息">
        <JsonPreview value={{ ...item.metadata, userAgent: item.userAgent, did: item.logTask?.did }} />
      </Descriptions.Item>
      <Descriptions.Item label="日志">
        {item.logTask ? (
          <Space>{item.logTask.status}
            <Button disabled={!item.logTask.hasFile} onClick={() => void downloadLogs(item).catch(onError)}>下载日志</Button>
          </Space>
        ) : "—"}
      </Descriptions.Item>
    </Descriptions>
  );
}

interface Props {
  item: AdminFeedbackItem;
  statusBusy: boolean;
  onClose: () => void;
  onError: (error: unknown) => void;
  onReplySent: (feedbackId: string, close: boolean) => void;
  onStatusChange: (item: AdminFeedbackItem, status: FeedbackStatus) => void;
}

export function FeedbackThreadDrawer({ item, statusBusy, onClose, onError, onReplySent, onStatusChange }: Props) {
  const [revision, setRevision] = useState(0);
  const [sending, setSending] = useState(false);
  const closed = item.status === "done";

  return (
    <Drawer
      onClose={onClose}
      open
      size={680}
      title="反馈详情"
      styles={{ body: { display: "flex", flexDirection: "column", gap: 16 } }}
      extra={
        <Space>
          <Button onClick={() => setRevision((n) => n + 1)} disabled={sending}>刷新</Button>
          <Button
            onClick={() => onStatusChange(item, closed ? "doing" : "done")}
            disabled={sending || statusBusy}
            loading={statusBusy}
          >
            {closed ? "重新处理" : "结单"}
          </Button>
        </Space>
      }
      footer={
        <FeedbackReplyComposer
          closed={closed}
          feedbackId={item.id}
          statusBusy={statusBusy}
          onSending={setSending}
          onSent={(close) => {
            setRevision((n) => n + 1);
            onReplySent(item.id, close);
          }}
        />
      }
    >
      <Space wrap>
        <strong>{feedbackUserLabel(item)}</strong>
        <Tag color={feedbackStatusColor(item.status)}>{feedbackStatusLabel(item.status)}</Tag>
        {item.needsReply && !closed ? <Tag color="gold">待回复</Tag> : null}
      </Space>
      <Collapse size="small" items={[{
        key: "diagnostics",
        label: "诊断信息",
        children: <FeedbackDiagnostics item={item} onError={onError} />,
      }]} />
      <FeedbackThreadMessages feedbackId={item.id} revision={revision} />
    </Drawer>
  );
}

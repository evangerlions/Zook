import { Button, Empty, Select, Space, Table, Tag, type TableColumnsType } from "antd";
import { useEffect, useState } from "react";
import { FeedbackThreadDrawer } from "../components/feedback/feedback-thread-drawer";
import { adminFeedbackApi } from "../lib/admin-feedback-api";
import { useAdminSession } from "../lib/admin-session";
import { FEEDBACK_STATUS_OPTIONS, feedbackAttachmentLabel, feedbackMessagePreview, feedbackUserLabel } from "../lib/feedback";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type { AdminFeedbackItem, FeedbackStatus } from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";
type FeedbackFilter = FeedbackStatus | "all" | "pending";

const statusOptions = FEEDBACK_STATUS_OPTIONS.map(({ value, label }) => ({ value, label }));
const filterOptions = [
  { value: "all", label: "全部反馈" },
  { value: "pending", label: "待回复" },
  ...statusOptions,
];

function feedbackColumns(
  updatingStatusId: string | null,
  onOpen: (item: AdminFeedbackItem) => void,
  onStatusChange: (item: AdminFeedbackItem, status: FeedbackStatus) => void,
): TableColumnsType<AdminFeedbackItem> {
  return [
    {
      title: "最近活动", width: 180,
      render: (_, item) => formatTimestamp(item.updatedAt || item.createdAt),
    },
    { title: "用户", render: (_, item) => feedbackUserLabel(item), width: 220 },
    {
      title: "反馈",
      render: (_, item) => (
        <Space wrap size={4}>
          {item.needsReply && item.status !== "done" ? <Tag color="gold">待回复</Tag> : null}
          {feedbackMessagePreview(item.message)}
        </Space>
      ),
    },
    { title: "附件", render: (_, item) => feedbackAttachmentLabel(item.attachmentCount), width: 110 },
    {
      title: "平台", width: 140,
      render: (_, item) => (
        <Space wrap size={4}>
          {item.platform ? <Tag>{item.platform}</Tag> : null}
          {item.appVersion ? <Tag>{item.appVersion}</Tag> : null}
        </Space>
      ),
    },
    {
      title: "状态", width: 135,
      render: (_, item) => (
        <Select<FeedbackStatus>
          aria-label="调整反馈状态"
          disabled={updatingStatusId !== null}
          loading={updatingStatusId === item.id}
          onChange={(status) => onStatusChange(item, status)}
          options={statusOptions}
          popupMatchSelectWidth={false}
          size="small"
          value={item.status}
        />
      ),
    },
    {
      title: "操作", width: 78,
      render: (_, item) => <Button size="small" onClick={() => onOpen(item)}>详情</Button>,
    },
  ];
}

export default function FeedbackRoute() {
  const { apps, selectedAppId, setNotice, completeWorkspaceTransition } = useAdminSession();
  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminFeedbackItem | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  const reportError = (error: unknown) => setNotice(makeNotice("error", formatApiError(error)));

  useEffect(() => {
    if (selectedAppId !== AI_NOVEL_APP_ID) {
      setSelected(null);
      setItems([]);
      setLoading(false);
      completeWorkspaceTransition();
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void adminFeedbackApi.getAiNovelFeedback({
      limit: 100,
      status: filter === "pending" ? undefined : filter,
      needsReply: filter === "pending",
      signal: controller.signal,
    }).then((data) => {
      if (controller.signal.aborted) return;
      setItems(data.items);
      setSelected((current) => data.items.find((item) => item.id === current?.id) ?? current);
    }).catch((error) => {
      if (!controller.signal.aborted) setNotice(makeNotice("error", formatApiError(error)));
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        completeWorkspaceTransition();
      }
    });
    return () => controller.abort();
  }, [completeWorkspaceTransition, filter, revision, selectedAppId, setNotice]);

  async function updateStatus(item: AdminFeedbackItem, status: FeedbackStatus) {
    if (item.status === status || updatingStatusId) return;
    setUpdatingStatusId(item.id);
    try {
      const result = await adminFeedbackApi.updateAiNovelFeedbackStatus(item.id, status);
      setSelected((current) => current?.id === result.id
        ? { ...current, status: result.status, updatedAt: result.updatedAt,
          needsReply: result.status === "done" ? false : current.needsReply }
        : current);
      refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setUpdatingStatusId(null);
    }
  }

  function afterReply(feedbackId: string, close: boolean) {
    setSelected((current) => current?.id === feedbackId
      ? { ...current, needsReply: false, status: close ? "done" : current.status === "new" ? "doing" : current.status }
      : current);
    refresh();
  }

  if (selectedAppId !== AI_NOVEL_APP_ID || !apps.some((app) => app.appId === AI_NOVEL_APP_ID)) {
    return <section className="empty-state">请切换到橘子写作项目查看反馈。</section>;
  }

  return (
    <section className="stack">
      <header className="page-header">
        <h1>反馈</h1>
        <Space>
          <Select<FeedbackFilter>
            aria-label="反馈状态筛选"
            onChange={setFilter}
            options={filterOptions}
            style={{ width: 140 }}
            value={filter}
          />
          <Button onClick={refresh} loading={loading}>刷新</Button>
        </Space>
      </header>
      <section className="surface-card">
        <Table<AdminFeedbackItem>
          columns={feedbackColumns(updatingStatusId, setSelected, (item, status) => void updateStatus(item, status))}
          dataSource={items}
          loading={loading}
          locale={{ emptyText: <Empty description={filter === "pending" ? "暂无待回复的反馈" : "暂无用户反馈"} /> }}
          pagination={{ pageSize: 20 }}
          rowKey="id"
          scroll={{ x: 940 }}
        />
      </section>
      {selected ? (
        <FeedbackThreadDrawer
          key={selected.id}
          item={selected}
          onClose={() => setSelected(null)}
          onError={reportError}
          onReplySent={afterReply}
          onStatusChange={(item, status) => void updateStatus(item, status)}
          statusBusy={updatingStatusId === selected.id}
        />
      ) : null}
    </section>
  );
}

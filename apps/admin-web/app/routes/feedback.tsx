import { Button, Descriptions, Drawer, Empty, Image, Select, Space, Table, Tag } from "antd";
import { useEffect, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import {
  feedbackAttachmentDataUrl,
  feedbackAttachmentLabel,
  feedbackAttachmentMeta,
  FEEDBACK_STATUS_OPTIONS,
  feedbackMessagePreview,
  feedbackStatusColor,
  feedbackStatusLabel,
  feedbackUserLabel,
} from "../lib/feedback";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminFeedbackAttachmentContentDocument,
  AdminFeedbackItem,
  AdminFeedbackListDocument,
  FeedbackStatus,
} from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";
type FeedbackStatusFilter = FeedbackStatus | "all";

export default function FeedbackRoute() {
  const {
    apps,
    selectedAppId,
    setNotice,
    completeWorkspaceTransition,
  } = useAdminSession();
  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID) ?? null;
  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  const [document, setDocument] = useState<AdminFeedbackListDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusFilter>("all");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminFeedbackItem | null>(null);
  const [attachmentContent, setAttachmentContent] = useState<
    Record<string, AdminFeedbackAttachmentContentDocument>
  >({});
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null);

  async function loadLatest() {
    if (selectedAppId !== AI_NOVEL_APP_ID) {
      setDocument(null);
      completeWorkspaceTransition();
      return;
    }

    setLoading(true);
    try {
      setDocument(await adminApi.getAiNovelFeedback({ limit: 100, status: statusFilter }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    void loadLatest();
  }, [selectedAppId, statusFilter]);

  async function updateStatus(item: AdminFeedbackItem, status: FeedbackStatus) {
    if (item.status === status) {
      return;
    }
    setUpdatingStatusId(item.id);
    try {
      const result = await adminApi.updateAiNovelFeedbackStatus(item.id, status);
      setDocument((current) => current
        ? {
            ...current,
            items: current.items
              .map((existing) => existing.id === result.id
                ? { ...existing, status: result.status, updatedAt: result.updatedAt }
                : existing)
              .filter((existing) => statusFilter === "all" || existing.status === statusFilter),
          }
        : current);
      setSelected((current) => current?.id === result.id
        ? { ...current, status: result.status, updatedAt: result.updatedAt }
        : current);
      setNotice(makeNotice("success", `反馈状态已更新为 ${feedbackStatusLabel(result.status)}`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setUpdatingStatusId(null);
    }
  }

  async function openDetail(item: AdminFeedbackItem) {
    setSelected(item);
    setAttachmentContent({});
    for (const attachment of item.attachments) {
      setLoadingAttachmentId(attachment.id);
      try {
        const content = await adminApi.getAiNovelFeedbackAttachment(item.id, attachment.id);
        setAttachmentContent((current) => ({
          ...current,
          [attachment.id]: content,
        }));
      } catch (error) {
        setNotice(makeNotice("error", formatApiError(error)));
      } finally {
        setLoadingAttachmentId(null);
      }
    }
  }

  if (!aiNovelApp) {
    return (
      <section className="empty-state">
        当前工作区中还没有 `ai_novel` 项目，暂时无法查看 Feedback。
      </section>
    );
  }

  if (selectedApp?.appId !== AI_NOVEL_APP_ID) {
    return (
      <section className="empty-state">
        Feedback 目前只支持 `ai_novel`。请先在项目空间切换到 `ai_novel` 再查看。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>Feedback</h1>
          <p>查看 AINovel 用户在 App 内提交的反馈与截图。附件通过 Admin 会话私有读取。</p>
        </div>
        <Space>
          <Select<FeedbackStatusFilter>
            aria-label="反馈状态筛选"
            onChange={(value) => setStatusFilter(value)}
            options={[
              { value: "all", label: "全部状态" },
              ...FEEDBACK_STATUS_OPTIONS.map((item) => ({
                value: item.value,
                label: item.label,
              })),
            ]}
            style={{ width: 140 }}
            value={statusFilter}
          />
          <Button onClick={() => void loadLatest()} loading={loading}>
            刷新
          </Button>
        </Space>
      </header>

      <section className="surface-card">
        <Table<AdminFeedbackItem>
          columns={[
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 180,
              render: (value) => formatTimestamp(value),
            },
            {
              title: "用户",
              render: (_, item) => feedbackUserLabel(item),
              width: 220,
            },
            {
              title: "反馈",
              render: (_, item) => feedbackMessagePreview(item.message),
            },
            {
              title: "附件",
              render: (_, item) => feedbackAttachmentLabel(item.attachmentCount),
              width: 120,
            },
            {
              title: "平台",
              render: (_, item) => (
                <Space size={4}>
                  {item.platform ? <Tag>{item.platform}</Tag> : null}
                  {item.appVersion ? <Tag>{item.appVersion}</Tag> : null}
                </Space>
              ),
              width: 160,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 140,
              render: (_, item) => (
                <Select<FeedbackStatus>
                  aria-label="调整反馈状态"
                  loading={updatingStatusId === item.id}
                  onChange={(value) => void updateStatus(item, value)}
                  options={FEEDBACK_STATUS_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  popupMatchSelectWidth={false}
                  size="small"
                  value={item.status}
                />
              ),
            },
            {
              title: "操作",
              width: 100,
              render: (_, item) => (
                <Button size="small" onClick={() => void openDetail(item)}>
                  详情
                </Button>
              ),
            },
          ]}
          dataSource={document?.items ?? []}
          loading={loading}
          locale={{
            emptyText: <Empty description="暂无用户反馈" />,
          }}
          pagination={{ pageSize: 20 }}
          rowKey="id"
        />
      </section>

      <Drawer
        onClose={() => setSelected(null)}
        open={Boolean(selected)}
        title="反馈详情"
        width={560}
      >
        {selected ? (
          <div className="stack">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="用户">{feedbackUserLabel(selected)}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{formatTimestamp(selected.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="平台">
                {[selected.platform, selected.appVersion, selected.locale].filter(Boolean).join(" · ") || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={feedbackStatusColor(selected.status)}>
                  {feedbackStatusLabel(selected.status)}
                </Tag>
              </Descriptions.Item>
            </Descriptions>

            <section className="surface-card">
              <h3>反馈内容</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{selected.message}</p>
            </section>

            <section className="surface-card">
              <h3>附件</h3>
              {selected.attachments.length === 0 ? (
                <Empty description="没有附件" />
              ) : (
                <div className="feedback-attachment-grid">
                  {selected.attachments.map((attachment) => {
                    const content = attachmentContent[attachment.id];
                    return (
                      <div className="feedback-attachment-card" key={attachment.id}>
                        {content ? (
                          <Image
                            alt={attachment.fileName}
                            src={feedbackAttachmentDataUrl(content)}
                          />
                        ) : (
                          <div className="feedback-attachment-loading">
                            {loadingAttachmentId === attachment.id ? "加载中…" : "未加载"}
                          </div>
                        )}
                        <strong>{attachment.fileName}</strong>
                        <small>{feedbackAttachmentMeta(attachment)}</small>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}

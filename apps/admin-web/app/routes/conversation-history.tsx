import { Button, Descriptions, Drawer, Empty, Input, Segmented, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useRef, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminAiNovelConversationRecord,
  AdminAiNovelConversationRecordDocument,
} from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";
const SCENE_TAG_COLORS: Record<string, string> = {
  kickoff_turn: "blue",
  kickoff_turn_imported_book: "purple",
  write_turn: "green",
  history_chapter_qa: "orange",
};
type QueryType = "uid" | "did";
type ConversationQuery = Pick<AdminAiNovelConversationRecordDocument["query"], "uid" | "did">;

export default function ConversationHistoryRoute() {
  const { apps, selectedAppId, setNotice } = useAdminSession();
  const [queryType, setQueryType] = useState<QueryType>("uid");
  const [queryValue, setQueryValue] = useState("");
  const [document, setDocument] = useState<AdminAiNovelConversationRecordDocument | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AdminAiNovelConversationRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID);
  const isAiNovelSelected = selectedAppId === AI_NOVEL_APP_ID;

  function inputQuery(): ConversationQuery {
    const value = queryValue.trim();
    if (!value) return {};
    return queryType === "uid" ? { uid: value } : { did: value };
  }

  async function load(page = 0, query = inputQuery()) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setSelectedRecord(null);
    try {
      const nextDocument = await adminApi.getAiNovelConversationRecords({
        ...query,
        page,
      });
      if (requestId === requestRef.current) setDocument(nextDocument);
    } catch (error) {
      if (requestId === requestRef.current) {
        setNotice(makeNotice("error", formatApiError(error)));
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAiNovelSelected) {
      requestRef.current += 1;
      setDocument(null);
      setSelectedRecord(null);
      setLoading(false);
      return;
    }
    void load(0, {});
  }, [selectedAppId]);

  if (!aiNovelApp) {
    return <section className="empty-state">当前工作区中还没有 `ai_novel` 项目，暂时无法查看历史聊天。</section>;
  }

  if (!isAiNovelSelected) {
    return <section className="empty-state">历史聊天仅支持 AINovel。请先在项目空间切换到 `ai_novel`。</section>;
  }

  const records = document?.items ?? [];

  return (
    <section className="stack conversation-history-page">
      <header className="page-header">
        <div>
          <h1>历史聊天</h1>
          <p>查询服务端保存的已完成聊天摘要；消息列表按高密度表格展示，点击详情查看完整内容。</p>
        </div>
        <Button loading={loading} onClick={() => void load(document?.page ?? 0, document?.query ?? inputQuery())}>刷新</Button>
      </header>

      <section className="surface-card conversation-history-search">
        <Space wrap>
          <Segmented<QueryType>
            onChange={(value) => setQueryType(value)}
            options={[
              { label: "UID", value: "uid" },
              { label: "DID", value: "did" },
            ]}
            value={queryType}
          />
          <Input.Search
            allowClear
            aria-label={`${queryType.toUpperCase()} 查询，可留空显示全部历史聊天`}
            onChange={(event) => setQueryValue(event.target.value)}
            onSearch={() => void load(0)}
            placeholder={`可选：输入 ${queryType.toUpperCase()}`}
            style={{ width: 320 }}
            value={queryValue}
          />
        </Space>
      </section>

      <section className="surface-card conversation-history-table-card">
        <header className="conversation-history-table-header">
          <div>
            <h2>{document ? `第 ${document.page + 1} 页` : "聊天列表"}</h2>
            <p>{document ? `${queryLabel(document.query)} · 当前显示 ${records.length} 个 Turn，按时间从新到旧排列。` : "正在加载历史聊天记录…"}</p>
          </div>
          <Space>
            <Button disabled={!document || document.page === 0 || loading} onClick={() => {
              if (document) void load(document.page - 1, document.query);
            }}>
              上一页
            </Button>
            <Button disabled={!document || !document.hasMore || loading} onClick={() => {
              if (document) void load(document.page + 1, document.query);
            }}>
              下一页
            </Button>
          </Space>
        </header>

        <Table<AdminAiNovelConversationRecord>
          className="conversation-history-table"
          columns={conversationHistoryColumns(setSelectedRecord)}
          dataSource={records}
          loading={loading}
          locale={{ emptyText: <Empty description="没有找到历史聊天" /> }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 1040 }}
          size="small"
        />
      </section>

      <Drawer
        className="conversation-history-drawer"
        onClose={() => setSelectedRecord(null)}
        open={Boolean(selectedRecord)}
        placement="right"
        title="聊天详情"
        width={560}
      >
        {selectedRecord ? <ConversationHistoryDetail record={selectedRecord} /> : null}
      </Drawer>
    </section>
  );
}

function conversationHistoryColumns(
  onOpenDetail: (record: AdminAiNovelConversationRecord) => void,
): ColumnsType<AdminAiNovelConversationRecord> {
  return [
    {
      title: "场景",
      dataIndex: "sceneKey",
      width: 150,
      render: (value: string) => <Tag color={sceneTagColor(value)}>{value}</Tag>,
    },
    {
      title: "用户消息",
      dataIndex: "userText",
      width: 300,
      render: (value: string) => <MessagePreview content={value} />,
    },
    {
      title: "AI 回复",
      dataIndex: "assistantText",
      width: 360,
      render: (value: string) => <MessagePreview content={value} />,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 170,
      render: (value: string) => formatTimestamp(value),
    },
    {
      title: "用户",
      width: 180,
      render: (_, record) => (
        <div className="conversation-history-user">
          <strong>{record.userId}</strong>
          {record.did ? <small>DID {record.did}</small> : null}
        </div>
      ),
    },
    {
      title: "操作",
      width: 84,
      fixed: "right",
      render: (_, record) => (
        <Button size="small" onClick={() => onOpenDetail(record)}>详情</Button>
      ),
    },
  ];
}

function MessagePreview({ content }: { content: string }) {
  const value = content || "（无正文）";
  return <div className={`conversation-history-message-preview${content ? "" : " is-empty"}`} title={content || undefined}>{value}</div>;
}

function ConversationHistoryDetail({ record }: { record: AdminAiNovelConversationRecord }) {
  return (
    <div className="conversation-history-detail">
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="场景"><Tag color={sceneTagColor(record.sceneKey)}>{record.sceneKey}</Tag></Descriptions.Item>
        <Descriptions.Item label="用户">{record.userId}</Descriptions.Item>
        <Descriptions.Item label="DID">{record.did ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="时间">{formatTimestamp(record.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="请求 ID">{record.requestId}</Descriptions.Item>
        <Descriptions.Item label="消息 ID">{record.messageId ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="会话 ID">{record.sessionId ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="Turn ID">{record.turnId ?? "—"}</Descriptions.Item>
      </Descriptions>
      <MessageDetail label="用户消息" content={record.userText} />
      <MessageDetail label="AI 回复" content={record.assistantText} />
    </div>
  );
}

function MessageDetail({ label, content }: { label: string; content: string }) {
  return (
    <section className="conversation-history-message-detail">
      <h3>{label}</h3>
      <pre>{content || "（无正文）"}</pre>
    </section>
  );
}

function queryLabel(query: ConversationQuery): string {
  if (query.uid) return `UID ${query.uid}`;
  if (query.did) return `DID ${query.did}`;
  return "全部用户";
}

function sceneTagColor(sceneKey: string): string {
  return SCENE_TAG_COLORS[sceneKey] ?? "default";
}

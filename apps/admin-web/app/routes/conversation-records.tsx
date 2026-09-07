import { Button, Empty, Input, Segmented, Space, Spin, Tag } from "antd";
import { useEffect, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type { AdminAiNovelConversationRecordDocument } from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";
type QueryType = "uid" | "did";
type ConversationQuery = Pick<AdminAiNovelConversationRecordDocument["query"], "uid" | "did">;

export default function ConversationRecordsRoute() {
  const { apps, selectedAppId, setNotice } = useAdminSession();
  const [queryType, setQueryType] = useState<QueryType>("uid");
  const [queryValue, setQueryValue] = useState("");
  const [document, setDocument] = useState<AdminAiNovelConversationRecordDocument | null>(null);
  const [loading, setLoading] = useState(false);

  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID);
  const isAiNovelSelected = selectedAppId === AI_NOVEL_APP_ID;

  function inputQuery(): ConversationQuery {
    const value = queryValue.trim();
    if (!value) return {};
    return queryType === "uid" ? { uid: value } : { did: value };
  }

  async function load(page = 0, query = inputQuery()) {
    setLoading(true);
    try {
      setDocument(await adminApi.getAiNovelConversationRecords({
        ...query,
        page,
      }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAiNovelSelected) {
      setDocument(null);
      return;
    }
    void load(0, {});
  }, [selectedAppId]);

  if (!aiNovelApp) {
    return <section className="empty-state">当前工作区中还没有 `ai_novel` 项目，暂时无法查看对话记录。</section>;
  }

  if (!isAiNovelSelected) {
    return <section className="empty-state">对话记录仅支持 AINovel。请先在项目空间切换到 `ai_novel`。</section>;
  }

  return (
    <section className="stack conversation-records-page">
      <header className="page-header">
        <div>
          <h1>对话记录</h1>
          <p>默认显示全部用户最新 200 条消息；输入 UID 或 DID 可精确筛选，每页对应 100 个完整 Turn。</p>
        </div>
      </header>

      <section className="surface-card conversation-records-search">
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
            aria-label={`${queryType.toUpperCase()} 查询，可留空显示全部最新消息`}
            onChange={(event) => setQueryValue(event.target.value)}
            onSearch={() => void load(0)}
            placeholder={`可选：输入 ${queryType.toUpperCase()}`}
            style={{ width: 320 }}
            value={queryValue}
          />
        </Space>
      </section>

      {loading ? <section className="surface-card"><Spin /></section> : null}

      {document ? (
        <section className="surface-card conversation-records-list">
          <header className="conversation-records-list-header">
            <div>
              <h2>第 {document.page + 1} 页</h2>
              <p>{queryLabel(document.query)} · 当前显示 {document.items.length * 2} 条消息，按时间从新到旧排列。</p>
            </div>
            <Space>
              <Button disabled={document.page === 0 || loading} onClick={() => void load(document.page - 1, document.query)}>
                上一页
              </Button>
              <Button disabled={!document.hasMore || loading} onClick={() => void load(document.page + 1, document.query)}>
                下一页
              </Button>
            </Space>
          </header>

          {document.items.length ? document.items.map((item) => (
            <article className="conversation-record" key={item.id}>
              <header>
                <div>
                  <Tag>{item.sceneKey}</Tag>
                  <Tag color="blue">UID {item.userId}</Tag>
                  {item.did ? <Tag>DID {item.did}</Tag> : null}
                </div>
                <time>{formatTimestamp(item.createdAt)}</time>
              </header>
              <ConversationMessage label="用户" content={item.userText} />
              <ConversationMessage label="AI" content={item.assistantText} />
            </article>
          )) : <Empty description="没有找到对话记录" />}
        </section>
      ) : null}
    </section>
  );
}

function ConversationMessage({ label, content }: { label: string; content: string }) {
  return (
    <section className="conversation-message">
      <strong>{label}</strong>
      <pre>{content || "（无正文）"}</pre>
    </section>
  );
}

function queryLabel(query: ConversationQuery): string {
  if (query.uid) return `UID ${query.uid}`;
  if (query.did) return `DID ${query.did}`;
  return "全部用户";
}

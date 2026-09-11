import { Button, Input, Select, Space } from "antd";
import { useEffect, useRef, useState } from "react";

import { ConversationTraceView } from "../components/conversation-trace-view";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type {
  AdminAiNovelDebugTraceDocument,
  AiNovelDebugTraceManifest,
  AiNovelTraceKind,
  AiNovelTraceStatus,
} from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";

interface TraceFilters {
  uid: string;
  cid: string;
  kind?: AiNovelTraceKind;
  status?: AiNovelTraceStatus;
  bookId: string;
  chapterId: string;
  query: string;
}

const EMPTY_FILTERS: TraceFilters = {
  uid: "",
  cid: "",
  bookId: "",
  chapterId: "",
  query: "",
};

export default function ConversationRecordsRoute() {
  const { apps, runtimeConfig, selectedAppId, setNotice } = useAdminSession();
  const [filters, setFilters] = useState<TraceFilters>(EMPTY_FILTERS);
  const [sessions, setSessions] = useState<AiNovelDebugTraceManifest[]>([]);
  const [selectedSession, setSelectedSession] = useState<AiNovelDebugTraceManifest | null>(null);
  const [trace, setTrace] = useState<AdminAiNovelDebugTraceDocument | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const sessionsRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID);
  const isAiNovelSelected = selectedAppId === AI_NOVEL_APP_ID;

  useEffect(() => {
    if (!isAiNovelSelected || !runtimeConfig.traceConsoleEnabled) {
      sessionsRequestRef.current += 1;
      detailRequestRef.current += 1;
      setSessions([]);
      setSelectedSession(null);
      setTrace(null);
      setDetailError(null);
      return;
    }
    void loadSessions(EMPTY_FILTERS);
  }, [isAiNovelSelected, runtimeConfig.traceConsoleEnabled]);

  async function loadSessions(nextFilters: TraceFilters) {
    const requestId = ++sessionsRequestRef.current;
    detailRequestRef.current += 1;
    setLoadingSessions(true);
    setTrace(null);
    setDetailError(null);
    try {
      const document = await adminApi.getAiNovelDebugTraceSessions(toApiFilters(nextFilters));
      if (requestId !== sessionsRequestRef.current) return;
      setFilters(nextFilters);
      setSessions(document.items);
      const current = selectedSession && document.items.find((item) => sameSession(item, selectedSession));
      const nextSession = current ?? document.items[0] ?? null;
      setSelectedSession(nextSession);
      if (nextSession) {
        await loadSession(nextSession);
      }
    } catch (error) {
      if (requestId !== sessionsRequestRef.current) return;
      setSessions([]);
      setSelectedSession(null);
      setDetailError(null);
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      if (requestId === sessionsRequestRef.current) setLoadingSessions(false);
    }
  }

  async function loadSession(session: AiNovelDebugTraceManifest) {
    const requestId = ++detailRequestRef.current;
    setSelectedSession(session);
    setTrace(null);
    setDetailError(null);
    setLoadingDetail(true);
    try {
      const document = await adminApi.getAiNovelDebugTraceSession(session.sessionId, session.kind);
      if (requestId === detailRequestRef.current) setTrace(document);
    } catch (error) {
      if (requestId !== detailRequestRef.current) return;
      setTrace(null);
      const message = formatApiError(error);
      setDetailError(message);
      setNotice(makeNotice("error", message));
    } finally {
      if (requestId === detailRequestRef.current) setLoadingDetail(false);
    }
  }

  function updateFilter<Key extends keyof TraceFilters>(key: Key, value: TraceFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  if (!aiNovelApp) {
    return <section className="empty-state">当前工作区中还没有 `ai_novel` 项目，暂时无法查看对话追踪。</section>;
  }

  if (!isAiNovelSelected) {
    return <section className="empty-state">对话追踪仅支持 AINovel。请先在项目空间切换到 `ai_novel`。</section>;
  }

  if (!runtimeConfig.traceConsoleEnabled) {
    return <section className="empty-state">Trace Console 仅在 local / dev 环境开放。</section>;
  }

  return (
    <section className="stack conversation-records-page">
      <header className="page-header">
        <div>
          <h1>对话记录</h1>
          <p>按 UID / CID 筛选已采集 Trace 的会话；每个 Turn 包含一次用户消息及其完整的 Pi / tool loop。未上传 Trace 的旧客户端记录不会出现在此页。</p>
        </div>
        <Button loading={loadingSessions} onClick={() => void loadSessions(filters)}>刷新</Button>
      </header>
      <TraceFilters filters={filters} loading={loadingSessions} onChange={updateFilter} onSubmit={() => void loadSessions(filters)} onClear={() => void loadSessions(EMPTY_FILTERS)} />
      <ConversationTraceView
        loadingDetail={loadingDetail}
        loadingSessions={loadingSessions}
        selectedSession={selectedSession}
        sessions={sessions}
        trace={trace}
        detailError={detailError}
        onRetrySession={selectedSession ? () => void loadSession(selectedSession) : undefined}
        onSelectSession={(session) => void loadSession(session)}
      />
    </section>
  );
}

function TraceFilters({
  filters,
  loading,
  onChange,
  onSubmit,
  onClear,
}: {
  filters: TraceFilters;
  loading: boolean;
  onChange: <Key extends keyof TraceFilters>(key: Key, value: TraceFilters[Key]) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  return (
    <section className="surface-card conversation-records-search">
      <div className="conversation-trace-filter-grid">
        <label><span>UID</span><Input onChange={(event) => onChange("uid", event.target.value)} onPressEnter={onSubmit} placeholder="用户 UID" value={filters.uid} /></label>
        <label><span>CID</span><Input onChange={(event) => onChange("cid", event.target.value)} onPressEnter={onSubmit} placeholder="会话 / session ID" value={filters.cid} /></label>
        <label><span>Kind</span><Select allowClear onChange={(value: AiNovelTraceKind | undefined) => onChange("kind", value)} options={traceKindOptions} placeholder="全部类型" value={filters.kind} /></label>
        <label><span>Status</span><Select allowClear onChange={(value: AiNovelTraceStatus | undefined) => onChange("status", value)} options={traceStatusOptions} placeholder="全部状态" value={filters.status} /></label>
      </div>
      <details className="conversation-trace-more-filters">
        <summary>更多筛选</summary>
        <div className="conversation-trace-filter-grid is-secondary">
          <label><span>关键词</span><Input onChange={(event) => onChange("query", event.target.value)} onPressEnter={onSubmit} placeholder="标题、书籍或章节" value={filters.query} /></label>
          <label><span>Book ID</span><Input onChange={(event) => onChange("bookId", event.target.value)} onPressEnter={onSubmit} placeholder="Book ID" value={filters.bookId} /></label>
          <label><span>Chapter ID</span><Input onChange={(event) => onChange("chapterId", event.target.value)} onPressEnter={onSubmit} placeholder="Chapter ID" value={filters.chapterId} /></label>
        </div>
      </details>
      <Space className="conversation-trace-filter-actions">
        <Button loading={loading} onClick={onSubmit} type="primary">筛选</Button>
        <Button disabled={loading} onClick={onClear}>清空</Button>
      </Space>
    </section>
  );
}

const traceKindOptions = [
  { label: "kickoff", value: "kickoff" },
  { label: "import_book", value: "import_book" },
  { label: "imported_kickoff", value: "imported_kickoff" },
  { label: "writing", value: "writing" },
  { label: "history_qa", value: "history_qa" },
  { label: "advance_chapter", value: "advance_chapter" },
] satisfies Array<{ label: string; value: AiNovelTraceKind }>;

const traceStatusOptions = [
  { label: "running", value: "running" },
  { label: "completed", value: "completed" },
  { label: "failed", value: "failed" },
  { label: "cancelled", value: "cancelled" },
] satisfies Array<{ label: string; value: AiNovelTraceStatus }>;

function toApiFilters(filters: TraceFilters) {
  return {
    uid: filters.uid.trim() || undefined,
    cid: filters.cid.trim() || undefined,
    kind: filters.kind,
    status: filters.status,
    bookId: filters.bookId.trim() || undefined,
    chapterId: filters.chapterId.trim() || undefined,
    query: filters.query.trim() || undefined,
  };
}

function sameSession(left: AiNovelDebugTraceManifest, right: AiNovelDebugTraceManifest): boolean {
  return left.sessionId === right.sessionId && left.kind === right.kind;
}

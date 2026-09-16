import { Empty, Input, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";

import { DetailPane, SceneTag, StatusIcon } from "./conversation-trace-detail";
import type {
  AdminAiNovelDebugTraceDocument,
  AiNovelDebugTraceManifest,
  AiNovelTraceTurn,
} from "../lib/types";

interface ConversationTraceViewProps {
  sessions: AiNovelDebugTraceManifest[];
  selectedSession: AiNovelDebugTraceManifest | null;
  trace: AdminAiNovelDebugTraceDocument | null;
  loadingSessions: boolean;
  loadingDetail: boolean;
  detailError: string | null;
  onRetrySession?: () => void;
  onSelectSession: (session: AiNovelDebugTraceManifest) => void;
}

export function ConversationTraceView({
  sessions,
  selectedSession,
  trace,
  loadingSessions,
  loadingDetail,
  detailError,
  onRetrySession,
  onSelectSession,
}: ConversationTraceViewProps) {
  const turns = trace?.viewModel.turns ?? [];
  const [turnSearch, setTurnSearch] = useState("");
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedTurnIndex(turns.length > 0 ? turns.length - 1 : null);
    setTurnSearch("");
  }, [trace]);

  const visibleTurns = useMemo(() => {
    const query = turnSearch.trim().toLocaleLowerCase();
    if (!query) return turns;
    return turns.filter((turn) => turnSearchText(turn).toLocaleLowerCase().includes(query));
  }, [turnSearch, turns]);
  const selectedTurn = selectedTurnIndex === null ? undefined : turns[selectedTurnIndex];

  return (
    <section className="conversation-trace-layout">
      <SessionsPane
        loading={loadingSessions}
        selectedSession={selectedSession}
        sessions={sessions}
        onSelectSession={onSelectSession}
      />
      <section className="conversation-trace-pane conversation-trace-turns">
        <header className="conversation-trace-pane-header">
          <span className="conversation-trace-eyebrow">Turns</span>
          <h2>Agent turns</h2>
          <p>一条用户消息及其完整的 Pi / tool loop</p>
          <Input
            aria-label="搜索消息、工具或场景"
            onChange={(event) => setTurnSearch(event.target.value)}
            placeholder="搜索消息、工具、场景…"
            value={turnSearch}
          />
        </header>
        {loadingDetail && !trace ? (
          <div className="conversation-trace-loading"><Spin size="small" /></div>
        ) : detailError ? (
          <div className="conversation-trace-inline-error">详情加载失败，请在右侧重试。</div>
        ) : visibleTurns.length > 0 ? (
          <div className="conversation-trace-turn-list">
            {visibleTurns.map((turn) => (
              <TurnCard
                key={turn.id}
                selected={turn.index === selectedTurnIndex}
                turn={turn}
                onSelect={() => setSelectedTurnIndex(turn.index)}
              />
            ))}
          </div>
        ) : (
          <Empty className="conversation-trace-empty" description={trace ? (turns.length > 0 ? "当前会话没有匹配的 Turn" : "此会话没有可解析的模型请求") : "选择一个会话查看 Turn"} />
        )}
      </section>
      <DetailPane
        error={detailError}
        loading={loadingDetail}
        onRetry={onRetrySession}
        previousTurn={selectedTurnIndex === null ? undefined : turns[selectedTurnIndex - 1]}
        turn={selectedTurn}
      />
    </section>
  );
}

function SessionsPane({
  sessions,
  selectedSession,
  loading,
  onSelectSession,
}: {
  sessions: AiNovelDebugTraceManifest[];
  selectedSession: AiNovelDebugTraceManifest | null;
  loading: boolean;
  onSelectSession: (session: AiNovelDebugTraceManifest) => void;
}) {
  return (
    <section className="conversation-trace-pane conversation-trace-sessions">
      <header className="conversation-trace-pane-header">
        <span className="conversation-trace-eyebrow">Sessions</span>
        <h2>{sessions.length}</h2>
        <p>一次连续的业务会话，按最近活动排序</p>
      </header>
      {loading ? (
        <div className="conversation-trace-loading"><Spin size="small" /></div>
      ) : sessions.length > 0 ? (
        <nav aria-label="Trace sessions" className="conversation-trace-session-list">
          {sessions.map((session) => {
            const active = selectedSession?.sessionId === session.sessionId && selectedSession.kind === session.kind;
            return (
              <button
                className={`conversation-trace-session${active ? " is-active" : ""}`}
                key={`${session.kind}:${session.sessionId}`}
                onClick={() => onSelectSession(session)}
                type="button"
              >
                <span className="conversation-trace-session-title">
                  <strong>{session.title || session.sessionId}</strong>
                  <StatusIcon status={session.status} />
                </span>
                <span className="conversation-trace-session-meta">
                  <SceneTag sceneKey={session.kind} />
                  <span>{formatTimestamp(session.updatedAt)}</span>
                </span>
                <span className="conversation-trace-session-meta">
                  UID {session.uid || "—"} · CID {session.sessionId}
                </span>
              </button>
            );
          })}
        </nav>
      ) : (
        <Empty className="conversation-trace-empty" description="没有匹配的 Trace 会话" />
      )}
    </section>
  );
}

function TurnCard({
  turn,
  selected,
  onSelect,
}: {
  turn: AiNovelTraceTurn;
  selected: boolean;
  onSelect: () => void;
}) {
  const userMessage = turn.userMessage ? messageText(turn.userMessage.content) : "没有找到用户消息";
  const sceneKeys = [...new Set(turn.requests.map((request) => request.sceneKey).filter((sceneKey): sceneKey is string => Boolean(sceneKey)))];
  return (
    <article className={`conversation-trace-turn${selected ? " is-selected" : ""}`}>
      <button className="conversation-trace-turn-button" onClick={onSelect} type="button">
        <span className="conversation-trace-turn-heading">
          <strong>Turn {turn.index + 1}</strong>
          <StatusIcon status={turn.status} />
        </span>
        <span className="conversation-trace-turn-user">{userMessage}</span>
        <span className="conversation-trace-facts">
          <span>{turn.requests.length} requests</span>
          {turn.tokenCount !== undefined ? <span className="is-token">{formatTokens(turn.tokenCount)}</span> : null}
          {turn.durationMs !== undefined ? <span className="is-duration">{formatDuration(turn.durationMs)}</span> : null}
        </span>
        {turn.toolNames.length > 0 ? (
          <span className="conversation-trace-tool-list">
            {turn.toolNames.map((tool) => <span className="trace-pill" key={tool}>{tool}</span>)}
          </span>
        ) : null}
        {sceneKeys.length > 0 ? (
          <span className="conversation-trace-tool-list">
            {sceneKeys.map((sceneKey) => <SceneTag key={sceneKey} sceneKey={sceneKey} />)}
          </span>
        ) : null}
      </button>
    </article>
  );
}

function turnSearchText(turn: AiNovelTraceTurn): string {
  return [
    turn.userMessage ? messageText(turn.userMessage.content) : "",
    ...turn.messages.map((message) => messageText(message.content)),
    turn.model,
    turn.transport,
    ...turn.toolNames,
    ...turn.requests.map((request) => request.sceneKey ?? ""),
  ].join(" ");
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === undefined || content === null) return "";
  return prettyJson(content);
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function formatTokens(value: number): string {
  return `${value.toLocaleString()} tok`;
}

function formatDuration(value: number): string {
  return `${(value / 1000).toFixed(1)}s`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

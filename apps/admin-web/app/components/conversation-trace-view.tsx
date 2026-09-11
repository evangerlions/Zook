import { Empty, Input, Spin } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  AdminAiNovelDebugTraceDocument,
  AiNovelDebugTraceManifest,
  AiNovelTraceDiffLine,
  AiNovelTraceMessage,
  AiNovelTraceRequest,
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
      <DetailPane error={detailError} loading={loadingDetail} onRetry={onRetrySession} turn={selectedTurn} />
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
                  <span className="trace-pill">{session.kind}</span>
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
      </button>
    </article>
  );
}

function DetailPane({
  error,
  loading,
  onRetry,
  turn,
}: {
  error: string | null;
  loading: boolean;
  onRetry?: () => void;
  turn?: AiNovelTraceTurn;
}) {
  if (loading && !turn) {
    return <section className="conversation-trace-pane conversation-trace-detail"><div className="conversation-trace-loading"><Spin /></div></section>;
  }
  if (error && !turn) {
    return (
      <section className="conversation-trace-pane conversation-trace-detail">
        <div className="conversation-trace-error">
          <strong>加载会话失败</strong>
          <p>{error}</p>
          {onRetry ? <button onClick={onRetry} type="button">重试</button> : null}
        </div>
      </section>
    );
  }
  if (!turn) {
    return <section className="conversation-trace-pane conversation-trace-detail"><Empty description="选择一个 Turn 查看详情" /></section>;
  }
  return (
    <section className="conversation-trace-pane conversation-trace-detail">
      <header className="conversation-trace-detail-header">
        <div>
          <span className="conversation-trace-eyebrow">Turn {turn.index + 1}</span>
          <h2>{truncate(messageText(turn.userMessage?.content), 120)}</h2>
          <p>{turn.id} · {formatTimestamp(turn.capturedAt)}</p>
        </div>
        <StatusIcon status={turn.status} />
      </header>
      <DetailSection title="Messages in current context" meta={`${turn.messages.length} messages`}>
        <div className="conversation-trace-message-list">
          {turn.messages.map((message, index) => <TraceMessage key={`${message.role}:${index}`} message={message} />)}
        </div>
      </DetailSection>
      <DetailSection title="All model requests in this turn" meta="最新请求默认展开，历史请求可折叠">
        <div className="conversation-trace-request-list">
          {turn.requests.map((request, index) => (
            <TraceRequest key={request.id} index={index} latest={index === turn.requests.length - 1} request={request} />
          ))}
        </div>
      </DetailSection>
      <DetailSection title="Context diff" meta="当前 Turn 与上一个 Turn 的上下文差异">
        <DiffView lines={turn.contextDiff} />
      </DetailSection>
    </section>
  );
}

function DetailSection({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <section className="conversation-trace-detail-section">
      <header><strong>{title}</strong><span>{meta}</span></header>
      <div className="conversation-trace-section-body">{children}</div>
    </section>
  );
}

function TraceMessage({ message }: { message: AiNovelTraceMessage }) {
  const role = normalizedRole(message.role);
  return (
    <article className={`conversation-trace-message is-${role}`}>
      <div className="conversation-trace-message-role"><RoleIcon role={role} />{message.role}</div>
      <pre>{messageText(message.content) || "（无正文）"}</pre>
    </article>
  );
}

function TraceRequest({ request, index, latest }: { request: AiNovelTraceRequest; index: number; latest: boolean }) {
  return (
    <details className="conversation-trace-request" open={latest}>
      <summary>
        <span><strong>LLM request {index + 1}</strong><small>{request.sceneKey || "model call"} · {formatTimestamp(request.capturedAt)}</small></span>
        <StatusIcon status={request.status} />
      </summary>
      <div className="conversation-trace-request-body">
        <div className="conversation-trace-facts">
          {request.model ? <span>{request.model}</span> : null}
          {request.transport ? <span>{request.transport}</span> : null}
          {request.tokenCount !== undefined ? <span className="is-token">{formatTokens(request.tokenCount)}</span> : null}
          {request.durationMs !== undefined ? <span className="is-duration">{formatDuration(request.durationMs)}</span> : null}
          {request.events.length > 0 ? <span>{request.events.length} events</span> : null}
        </div>
        {request.toolNames.length > 0 ? (
          <div className="conversation-trace-tool-list">
            {request.toolNames.map((tool) => <span className="trace-pill" key={tool}>{tool}</span>)}
          </div>
        ) : null}
        <div className="conversation-trace-message-list">
          {request.messages.map((message, messageIndex) => <TraceMessage key={`${message.role}:${messageIndex}`} message={message} />)}
        </div>
        <details className="conversation-trace-raw">
          <summary>查看原始 JSON</summary>
          <pre>{prettyJson(request.raw)}</pre>
        </details>
      </div>
    </details>
  );
}

function DiffView({ lines }: { lines: AiNovelTraceDiffLine[] }) {
  return lines.length > 0 ? (
    <pre className="conversation-trace-diff">
      {lines.map((line, index) => <span className={`conversation-trace-diff-line is-${line.kind}`} key={`${line.kind}:${index}`}><b>{linePrefix(line.kind)}</b>{line.text}\n</span>)}
    </pre>
  ) : <div className="conversation-trace-muted">没有可比较的上下文。</div>;
}

function StatusIcon({ status }: { status: string }) {
  const icon = status === "completed" ? "✓" : status === "running" ? "◌" : status === "failed" ? "!" : status === "cancelled" ? "×" : "?";
  return <span aria-label={status} className={`conversation-trace-status is-${status}`} title={status}>{icon}</span>;
}

function RoleIcon({ role }: { role: string }) {
  const icon = role === "user" ? "●" : role === "assistant" ? "✦" : role === "tool" ? "⚙" : role === "system" ? "◆" : "·";
  return <span aria-hidden="true" className="conversation-trace-role-icon">{icon}</span>;
}

function normalizedRole(role: string): string {
  return ["user", "assistant", "tool", "system"].includes(role) ? role : "other";
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

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function linePrefix(kind: AiNovelTraceDiffLine["kind"]): string {
  return kind === "added" ? "+ " : kind === "removed" ? "- " : "  ";
}

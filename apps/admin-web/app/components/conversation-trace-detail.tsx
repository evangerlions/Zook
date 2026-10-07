import { Empty, Spin, Tag } from "antd";
import { useEffect, useState, type ReactNode } from "react";

import { JsonEditor } from "./json-editor";
import { TraceJsonPreview, TraceMessageContent } from "./conversation-trace-content";
import { ConversationTraceDebugContext } from "./conversation-trace-debug-context";
import { ConversationContextUsageBadge } from "./conversation-context-usage-badge";
import { sceneTagColor } from "../lib/scene-tag";
import { traceMessageTurnNumbers } from "../lib/trace-message-turn";
import { resolveTraceToolName } from "../lib/trace-tool-name";
import { compactTraceRequestForJson, compactTraceTurnForJson } from "../lib/trace-json-projection";
import type {
  AiNovelTraceDiffLine,
  AiNovelTraceMessage,
  AiNovelTraceRequest,
  AiNovelTraceTurn,
} from "../lib/types";

type TraceViewMode = "rendered" | "json";

export function DetailPane({
  error,
  loading,
  onRetry,
  turn,
  previousTurn,
}: {
  error: string | null;
  loading: boolean;
  onRetry?: () => void;
  turn?: AiNovelTraceTurn;
  previousTurn?: AiNovelTraceTurn;
}) {
  const [viewMode, setViewMode] = useState<TraceViewMode>("rendered");
  const [changesOnly, setChangesOnly] = useState(true);
  const [collapsedMessageIndexes, setCollapsedMessageIndexes] = useState<Set<number>>(new Set());

  useEffect(() => {
    setViewMode("rendered");
    setChangesOnly(true);
    setCollapsedMessageIndexes(new Set());
  }, [turn?.id]);

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

  const changedMessageEntries = changesOnly ? changedMessages(turn, previousTurn) : turn.messages.map((message, index) => ({ message, index }));
  const requests = turn.requests.map((request, index) => ({ request, index }));
  const messageTurnNumbers = traceMessageTurnNumbers(turn.messages, turn.index + 1);
  const diff = changesOnly ? changedDiff(turn.contextDiff) : turn.contextDiff;
  const allMessagesCollapsed = changedMessageEntries.length > 0 && changedMessageEntries.every(({ index }) => collapsedMessageIndexes.has(index));
  const toggleAllMessages = () => {
    setCollapsedMessageIndexes(allMessagesCollapsed
      ? new Set()
      : new Set(changedMessageEntries.map(({ index }) => index)));
  };
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
      <TraceViewControls
        changesOnly={changesOnly}
        mode={viewMode}
        onChangesOnlyChange={setChangesOnly}
        onModeChange={setViewMode}
      />
      <ConversationTraceDebugContext turn={turn} />
      {viewMode === "json" ? (
        <JsonTraceSection turn={turn} changesOnly={changesOnly} previousTurn={previousTurn} />
      ) : (
        <>
          <DetailSection
            action={<button className="conversation-trace-section-action" disabled={changedMessageEntries.length === 0} onClick={toggleAllMessages} type="button">{allMessagesCollapsed ? "全部展开" : "全部折叠"}</button>}
            meta={`${changesOnly ? changedMessageEntries.length + " changed / " + turn.messages.length : turn.messages.length} messages`}
            title="Messages in current context"
          >
            <div className="conversation-trace-message-list">
              {renderMessageTimeline(turn.messages, changedMessageEntries, messageTurnNumbers, changesOnly, collapsedMessageIndexes, (index, open) => {
                setCollapsedMessageIndexes((current) => {
                  const next = new Set(current);
                  if (open) next.delete(index);
                  else next.add(index);
                  return next;
                });
              })}
            </div>
          </DetailSection>
          <DetailSection title="All model requests in this turn" meta={`${requests.length} requests`}>
            <div className="conversation-trace-request-list">
              {requests.length > 0 ? requests.map(({ request, index }) => (
                <TraceRequest key={request.id} index={index} request={request} />
              )) : <NoChanges label="请求" />}
            </div>
          </DetailSection>
          <DetailSection title="Context diff" meta="当前 Turn 与上一个 Turn 的上下文差异">
            <DiffView lines={diff} changesOnly={changesOnly} />
          </DetailSection>
        </>
      )}
    </section>
  );
}

function TraceViewControls({
  changesOnly,
  mode,
  onChangesOnlyChange,
  onModeChange,
}: {
  changesOnly: boolean;
  mode: TraceViewMode;
  onChangesOnlyChange: (value: boolean) => void;
  onModeChange: (mode: TraceViewMode) => void;
}) {
  return (
    <div className="conversation-trace-view-controls">
      <label className="conversation-trace-changes-toggle">
        <input checked={changesOnly} onChange={(event) => onChangesOnlyChange(event.target.checked)} type="checkbox" />
        <span>只显示修改</span>
      </label>
      <div aria-label="Trace detail view" className="conversation-trace-view-tabs" role="tablist">
        {(["rendered", "json"] as const).map((item) => (
          <button
            aria-selected={mode === item}
            className={`conversation-trace-view-tab${mode === item ? " is-active" : ""}`}
            key={item}
            onClick={() => onModeChange(item)}
            role="tab"
            type="button"
          >
            {item === "rendered" ? "渲染" : "JSON"}
          </button>
        ))}
      </div>
    </div>
  );
}

function JsonTraceSection({
  turn,
  changesOnly,
  previousTurn,
}: {
  turn: AiNovelTraceTurn;
  changesOnly: boolean;
  previousTurn?: AiNovelTraceTurn;
}) {
  const compactTurn = compactTraceTurnForJson(turn);
  const payload = changesOnly ? {
    turn: {
      id: turn.id,
      index: turn.index,
      status: turn.status,
      capturedAt: turn.capturedAt,
    },
    messages: changedMessages(turn, previousTurn).map(({ message }) => message),
    requests: turn.requests.map(compactTraceRequestForJson),
    contextDiff: changedDiff(turn.contextDiff),
  } : compactTurn;
  return (
    <DetailSection title="Turn JSON" meta={changesOnly ? "仅显示新增或修改字段" : "完整 Turn 数据（流式 delta 已合并）"}>
      <div className="conversation-trace-json">
        <JsonEditor height="min(186vh, 1800px)" readOnly value={prettyJson(payload)} />
      </div>
    </DetailSection>
  );
}

function DetailSection({ title, meta, action, children }: { title: string; meta: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="conversation-trace-detail-section">
      <header><strong>{title}</strong><span className="conversation-trace-section-meta">{meta}</span>{action}</header>
      <div className="conversation-trace-section-body">{children}</div>
    </section>
  );
}

function renderMessageTimeline(
  allMessages: AiNovelTraceMessage[],
  visibleEntries: Array<{ message: AiNovelTraceMessage; index: number }>,
  messageTurnNumbers: number[],
  changesOnly: boolean,
  collapsedIndexes: Set<number>,
  onToggle: (index: number, open: boolean) => void,
): ReactNode[] {
  if (!changesOnly) {
    return visibleEntries.map(({ message, index }) => <TraceMessage allMessages={allMessages} collapsed={collapsedIndexes.has(index)} index={index} key={`${message.role}:${index}`} message={message} onToggle={(open) => onToggle(index, open)} turnNumber={messageTurnNumbers[index]} />);
  }
  const changedIndexes = new Map(visibleEntries.map((entry) => [entry.index, entry.message]));
  const rendered: ReactNode[] = [];
  let omitted = 0;
  const flushOmitted = () => {
    if (omitted === 0) return;
    rendered.push(<span className="conversation-trace-message-ellipsis" key={`omitted:${rendered.length}`}>…（省略 {omitted} 条对话）</span>);
    omitted = 0;
  };
  allMessages.forEach((message, index) => {
    const changed = changedIndexes.get(index);
    if (!changed) {
      omitted += 1;
      return;
    }
    flushOmitted();
    rendered.push(<TraceMessage allMessages={allMessages} collapsed={collapsedIndexes.has(index)} index={index} key={`${message.role}:${index}`} message={message} onToggle={(open) => onToggle(index, open)} turnNumber={messageTurnNumbers[index]} />);
  });
  flushOmitted();
  return rendered;
}

function TraceMessage({ allMessages = [], message, index, collapsed = false, onToggle, turnNumber }: { allMessages?: readonly AiNovelTraceMessage[]; message: AiNovelTraceMessage; index: number; collapsed?: boolean; onToggle?: (open: boolean) => void; turnNumber?: number }) {
  const role = normalizedRole(message.role);
  const toolName = role === "tool" ? resolveTraceToolName(message, allMessages) : undefined;
  return (
    <details className={`conversation-trace-message is-${role}`} onToggle={(event) => onToggle?.(event.currentTarget.open)} open={!collapsed}>
      <summary className="conversation-trace-message-summary">
        <span className="conversation-trace-message-role">{turnNumber ? <span className="conversation-trace-message-turn">Turn {turnNumber}</span> : null}<span className="conversation-trace-message-sequence">#{index + 1}</span><RoleIcon role={role} />{message.role}{toolName ? <span className="conversation-trace-tool-name">{toolName}</span> : null}</span>
      </summary>
      <TraceMessageContent content={message.content} />
    </details>
  );
}

function TraceRequest({ request, index }: { request: AiNovelTraceRequest; index: number }) {
  return (
    <details className="conversation-trace-request">
      <summary>
        <span><strong>Req {index + 1}</strong><small>{request.sceneKey ? <SceneTag sceneKey={request.sceneKey} /> : "model call"} · {formatTimestamp(request.capturedAt)}</small></span>
        <span className="conversation-trace-request-summary-right">
          <ConversationContextUsageBadge usage={request.contextUsage} />
          <StatusIcon status={request.status} />
        </span>
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
          {request.messages.map((message, messageIndex) => <TraceMessage allMessages={request.messages} index={messageIndex} key={`${message.role}:${messageIndex}`} message={message} />)}
        </div>
        <details className="conversation-trace-raw">
          <summary>查看请求 JSON</summary>
          <TraceJsonPreview value={compactTraceRequestForJson(request)} />
        </details>
      </div>
    </details>
  );
}

function DiffView({ lines, changesOnly }: { lines: AiNovelTraceDiffLine[]; changesOnly: boolean }) {
  const rendered: ReactNode[] = [];
  let sameCount = 0;
  const flushSame = () => {
    if (sameCount === 0) return;
    rendered.push(<span className="conversation-trace-diff-ellipsis" key={`same:${rendered.length}`}>… {sameCount} 行未修改</span>);
    sameCount = 0;
  };
  lines.forEach((line, index) => {
    if (!changesOnly && line.kind === "same") {
      sameCount += 1;
      return;
    }
    flushSame();
    rendered.push(
      <span className={`conversation-trace-diff-line is-${line.kind}`} key={`${line.kind}:${index}`}>
        <b>{linePrefix(line.kind)}</b>{line.text}
        {"\n"}
      </span>,
    );
  });
  flushSame();
  return rendered.length > 0 ? <pre className="conversation-trace-diff">{rendered}</pre> : <NoChanges label="上下文" />;
}

function NoChanges({ label }: { label: string }) {
  return <div className="conversation-trace-muted">没有{label}修改。</div>;
}

export function SceneTag({ sceneKey }: { sceneKey: string }) {
  return <Tag className="conversation-trace-scene-tag" color={sceneTagColor(sceneKey)}>{sceneKey}</Tag>;
}

export function StatusIcon({ status }: { status: string }) {
  const icon = status === "completed" ? "✓" : status === "running" ? "◌" : status === "failed" ? "!" : status === "cancelled" ? "×" : "?";
  return <span aria-label={status} className={`conversation-trace-status is-${status}`} title={status}>{icon}</span>;
}

function RoleIcon({ role }: { role: string }) {
  const icon = role === "user" ? "●" : role === "assistant" ? "✦" : role === "tool" ? "⚙" : role === "system" ? "◆" : "·";
  return <span aria-hidden="true" className="conversation-trace-role-icon">{icon}</span>;
}

function changedMessages(turn: AiNovelTraceTurn, previousTurn?: AiNovelTraceTurn): Array<{ message: AiNovelTraceMessage; index: number }> {
  return turn.messages.flatMap((message, index) => !previousTurn || !sameValue(message, previousTurn.messages[index]) ? [{ message, index }] : []);
}

function changedDiff(lines: AiNovelTraceDiffLine[]): AiNovelTraceDiffLine[] {
  return lines.filter((line) => line.kind === "added" || line.kind === "removed");
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizedRole(role: string): string {
  return ["user", "assistant", "tool", "system"].includes(role) ? role : "other";
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

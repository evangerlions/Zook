import { Empty, Spin, Tag } from "antd";
import { useEffect, useState, type ReactNode } from "react";

import { JsonEditor } from "./json-editor";
import { sceneTagColor } from "../lib/scene-tag";
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
  const [changesOnly, setChangesOnly] = useState(false);

  useEffect(() => {
    setViewMode("rendered");
    setChangesOnly(false);
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

  const messages = changesOnly ? changedMessages(turn, previousTurn) : turn.messages;
  const requests = changesOnly ? changedRequests(turn, previousTurn) : turn.requests.map((request, index) => ({ request, index }));
  const diff = changesOnly ? changedDiff(turn.contextDiff) : turn.contextDiff;
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
      {viewMode === "json" ? (
        <JsonTraceSection turn={turn} changesOnly={changesOnly} previousTurn={previousTurn} />
      ) : (
        <>
          <DetailSection title="Messages in current context" meta={`${changesOnly ? messages.length + " changed / " + turn.messages.length : messages.length} messages`}>
            <div className="conversation-trace-message-list">
              {messages.length > 0 ? messages.map((message, index) => <TraceMessage key={`${message.role}:${index}`} message={message} />) : <NoChanges label="消息" />}
            </div>
          </DetailSection>
          <DetailSection title="All model requests in this turn" meta={changesOnly ? `${requests.length} changed / ${turn.requests.length}` : "最新请求默认展开，历史请求可折叠"}>
            <div className="conversation-trace-request-list">
              {requests.length > 0 ? requests.map(({ request, index }) => (
                <TraceRequest key={request.id} index={index} latest={index === turn.requests.length - 1} request={request} />
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
  const payload = changesOnly ? {
    turn: {
      id: turn.id,
      index: turn.index,
      status: turn.status,
      capturedAt: turn.capturedAt,
    },
    messages: changedMessages(turn, previousTurn),
    requests: changedRequests(turn, previousTurn).map(({ request }) => request),
    contextDiff: changedDiff(turn.contextDiff),
  } : {
    id: turn.id,
    index: turn.index,
    status: turn.status,
    capturedAt: turn.capturedAt,
    ...(turn.userMessage ? { userMessage: turn.userMessage } : {}),
    messages: turn.messages,
    requests: turn.requests,
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.transport ? { transport: turn.transport } : {}),
    ...(turn.tokenCount !== undefined ? { tokenCount: turn.tokenCount } : {}),
    ...(turn.durationMs !== undefined ? { durationMs: turn.durationMs } : {}),
    toolNames: turn.toolNames,
    contextDiff: turn.contextDiff,
    raw: turn.raw,
  };
  return (
    <DetailSection title="Turn JSON" meta={changesOnly ? "仅显示新增或修改字段" : "完整 Turn 数据"}>
      <div className="conversation-trace-json">
        <JsonEditor height="min(186vh, 1800px)" readOnly value={prettyJson(payload)} />
      </div>
    </DetailSection>
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
        <span><strong>LLM request {index + 1}</strong><small>{request.sceneKey ? <SceneTag sceneKey={request.sceneKey} /> : "model call"} · {formatTimestamp(request.capturedAt)}</small></span>
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

function changedMessages(turn: AiNovelTraceTurn, previousTurn?: AiNovelTraceTurn): AiNovelTraceMessage[] {
  return turn.messages.filter((message, index) => !previousTurn || !sameValue(message, previousTurn.messages[index]));
}

function changedRequests(turn: AiNovelTraceTurn, previousTurn?: AiNovelTraceTurn): Array<{ request: AiNovelTraceRequest; index: number }> {
  return turn.requests.flatMap((request, index) => {
    if (!previousTurn || request.events.length > 0 || index === turn.requests.length - 1 || request.messages.some((message, messageIndex) => !sameValue(message, previousTurn.messages[messageIndex]))) {
      return [{ request, index }];
    }
    return [];
  });
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

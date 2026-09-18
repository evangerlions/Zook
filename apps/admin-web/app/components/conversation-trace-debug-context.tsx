import { ConversationDebugToolList } from "./conversation-debug-tool-list";
import { TraceMarkdownContent } from "./conversation-trace-content";
import { collectTraceRequestDebugContext } from "../lib/trace-request-debug";
import type { AiNovelTraceTurn } from "../lib/types";

export function ConversationTraceDebugContext({ turn }: { turn: AiNovelTraceTurn }) {
  const debug = collectTraceRequestDebugContext(turn);
  return (
    <div className="conversation-trace-debug-context" aria-label="Request debug context">
      <details className="conversation-trace-debug-section">
        <summary>
          <span><strong>System prompt</strong><small>{debug.systemPrompt ? `${debug.systemPrompt.length} 字符` : "未采集"}</small></span>
          <span className="conversation-trace-debug-chevron" aria-hidden="true">⌄</span>
        </summary>
        {debug.systemPrompt ? (
          <div className="conversation-trace-debug-prompt">
            <TraceMarkdownContent text={debug.systemPrompt} />
          </div>
        ) : (
          <p className="conversation-trace-debug-empty">当前 Trace 没有保存 system prompt。</p>
        )}
      </details>
      <details className="conversation-trace-debug-section">
        <summary>
          <span><strong>Available tools</strong><small>{debug.tools.length} 个工具</small></span>
          <span className="conversation-trace-debug-chevron" aria-hidden="true">⌄</span>
        </summary>
        {debug.tools.length > 0 ? (
          <ConversationDebugToolList tools={debug.tools} />
        ) : (
          <p className="conversation-trace-debug-empty">当前 Trace 没有保存工具定义。</p>
        )}
      </details>
    </div>
  );
}

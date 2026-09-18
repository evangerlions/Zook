import { ConversationDebugToolList } from "./conversation-debug-tool-list";
import { TraceMarkdownContent } from "./conversation-trace-content";
import type { AdminAiNovelConversationRecord } from "../lib/types";

export function ConversationHistoryDebugDetails({
  record,
}: {
  record: AdminAiNovelConversationRecord;
}) {
  const hasSystemPrompt = Boolean(record.systemPrompt?.trim());
  const hasToolCapture = record.tools !== undefined;
  const tools = record.tools ?? [];
  return (
    <section className="conversation-history-debug" aria-label="请求调试信息">
      <details className="conversation-history-debug-section">
        <summary>
          <span><strong>System prompt</strong><small>{hasSystemPrompt ? `${record.systemPrompt!.length} 字符` : "旧记录未采集"}</small></span>
          <span className="conversation-history-debug-chevron" aria-hidden="true">⌄</span>
        </summary>
        {hasSystemPrompt ? (
          <div className="conversation-history-debug-prompt">
            <TraceMarkdownContent text={record.systemPrompt!} />
          </div>
        ) : (
          <p className="conversation-history-debug-empty">该记录生成时没有保存 system prompt。</p>
        )}
      </details>
      <details className="conversation-history-debug-section">
        <summary>
          <span><strong>Available tools</strong><small>{hasToolCapture ? `${tools.length} 个工具` : "旧记录未采集"}</small></span>
          <span className="conversation-history-debug-chevron" aria-hidden="true">⌄</span>
        </summary>
        {hasToolCapture && tools.length > 0 ? (
          <ConversationDebugToolList tools={tools} />
        ) : (
          <p className="conversation-history-debug-empty">
            {hasToolCapture ? "本轮没有可用工具。" : "该记录生成时没有保存工具定义。"}
          </p>
        )}
      </details>
    </section>
  );
}

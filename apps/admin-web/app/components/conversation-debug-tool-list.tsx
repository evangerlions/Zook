import { TraceJsonPreview, TraceMarkdownContent } from "./conversation-trace-content";

export interface ConversationDebugToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export function ConversationDebugToolList({
  tools,
}: {
  tools: readonly ConversationDebugToolDefinition[];
}) {
  return (
    <div className="conversation-debug-tool-list">
      {tools.map((tool, index) => (
        <details className="conversation-debug-tool" key={`${tool.name}:${index}`}>
          <summary>
            <code>{tool.name}</code>
            <span aria-hidden="true" className="conversation-debug-tool-chevron">⌄</span>
          </summary>
          <div className="conversation-debug-tool-body">
            {tool.description ? (
              <div className="conversation-debug-tool-description">
                <TraceMarkdownContent text={tool.description} />
              </div>
            ) : (
              <p className="conversation-debug-tool-description-empty">未采集 description</p>
            )}
            <span className="conversation-debug-tool-schema-label">Input schema</span>
            <TraceJsonPreview value={tool.inputSchema} />
          </div>
        </details>
      ))}
    </div>
  );
}

import type { ElementType, ReactNode } from "react";

const RENDERED_TEXT_FIELDS = new Set([
  "content",
  "description",
  "instruction",
  "message",
  "output",
  "prompt",
  "reason",
  "summary",
  "text",
]);

export function TraceMessageContent({ content }: { content: unknown }) {
  if (content === undefined || content === null || content === "") {
    return <div className="conversation-trace-content-empty">（无正文）</div>;
  }
  if (typeof content === "string") {
    const parsed = parseJson(content);
    return parsed === undefined ? <MarkdownContent text={content} /> : <TraceJsonPreview value={parsed} />;
  }
  return <TraceJsonPreview value={content} />;
}

export function TraceJsonPreview({ value }: { value: unknown }) {
  return <div className="conversation-trace-json-preview">{renderJsonValue(value, 0)}</div>;
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let codeLines: string[] | undefined;
  const flushCode = () => {
    if (!codeLines) return;
    blocks.push(<pre className="conversation-trace-markdown-code" key={`code:${blocks.length}`}>{codeLines.join("\n")}</pre>);
    codeLines = undefined;
  };
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      if (codeLines) flushCode();
      else codeLines = [];
      return;
    }
    if (codeLines) {
      codeLines.push(line);
      return;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<div className="conversation-trace-markdown-break" key={`break:${index}`} />);
      return;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1]!.length) as 1 | 2 | 3 | 4 | 5 | 6;
      const Heading = `h${level}` as ElementType;
      blocks.push(<Heading className="conversation-trace-markdown-heading" key={`heading:${index}`}>{renderInlineMarkdown(heading[2]!)}</Heading>);
      return;
    }
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      blocks.push(
        <div className="conversation-trace-markdown-list-item" key={`list:${index}`}>
          <span>•</span>
          <span className="conversation-trace-markdown-list-item-content">
            {renderInlineMarkdown(unordered[1]!)}
          </span>
        </div>,
      );
      return;
    }
    const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      blocks.push(
        <div className="conversation-trace-markdown-list-item" key={`ordered:${index}`}>
          <span>{ordered[1]}.</span>
          <span className="conversation-trace-markdown-list-item-content">
            {renderInlineMarkdown(ordered[2]!)}
          </span>
        </div>,
      );
      return;
    }
    blocks.push(<p className="conversation-trace-markdown-paragraph" key={`paragraph:${index}`}>{renderInlineMarkdown(line)}</p>);
  });
  flushCode();
  return <div className="conversation-trace-markdown">{blocks}</div>;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0]!;
    const start = match.index ?? 0;
    if (start > cursor) output.push(text.slice(cursor, start));
    if (value.startsWith("**") || value.startsWith("__")) output.push(<strong key={`strong:${start}`}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("`") ) output.push(<code key={`code:${start}`}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("*") || value.startsWith("_")) output.push(<em key={`em:${start}`}>{value.slice(1, -1)}</em>);
    else {
      const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) output.push(<a href={link[2]} key={`link:${start}`} rel="noreferrer" target="_blank">{link[1]}</a>);
      else output.push(value);
    }
    cursor = start + value.length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function renderJsonValue(value: unknown, depth: number, fieldName?: string): ReactNode {
  if (depth > 12) return <span className="conversation-trace-json-null">…</span>;
  if (value === null) return <span className="conversation-trace-json-null">null</span>;
  if (typeof value === "string") {
    return isRenderedTextField(fieldName)
      ? <JsonTextValue text={value} />
      : <span className="conversation-trace-json-string">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") return <span className="conversation-trace-json-number">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="conversation-trace-json-boolean">{String(value)}</span>;
  if (Array.isArray(value)) {
    return <div className="conversation-trace-json-composite">[
      {value.map((item, index) => <div className="conversation-trace-json-entry" key={index}>{renderJsonValue(item, depth + 1)}{index < value.length - 1 ? "," : ""}</div>)}
    ]</div>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return <div className="conversation-trace-json-composite">{"{"}
      {entries.map(([key, item], index) => <div className="conversation-trace-json-entry" key={key}><span className="conversation-trace-json-key">{JSON.stringify(key)}</span>: {renderJsonValue(item, depth + 1, key)}{index < entries.length - 1 ? "," : ""}</div>)}
    {"}"}</div>;
  }
  return <span className="conversation-trace-json-null">{String(value)}</span>;
}

function isRenderedTextField(fieldName?: string): boolean {
  return RENDERED_TEXT_FIELDS.has(fieldName?.toLowerCase() ?? "");
}

function JsonTextValue({ text }: { text: string }) {
  return <div className="conversation-trace-json-text-value"><MarkdownContent text={text} /></div>;
}

function parseJson(value: string): unknown {
  const normalized = value.trim();
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) return undefined;
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return undefined;
  }
}

import type { ElementType, ReactNode } from "react";
import { JsonPreview } from "./json-preview";
import { JsonCode } from "./json-code";

export function TraceMessageContent({ content }: { content: unknown }) {
  if (content === undefined || content === null || content === "") {
    return <div className="conversation-trace-content-empty">（无正文）</div>;
  }
  if (typeof content === "string") {
    const parsed = parseJson(content);
    return parsed === undefined ? <TraceMarkdownContent text={content} /> : <TraceJsonPreview value={parsed} />;
  }
  return <TraceJsonPreview value={content} />;
}

export function TraceJsonPreview({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2) ?? String(value);
  return <div className="conversation-trace-json-preview"><JsonPreview value={json} /></div>;
}

export function TraceMarkdownContent({ text }: { text: string }) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let codeLines: string[] | undefined;
  let codeLanguage = "";
  const flushCode = () => {
    if (!codeLines) return;
    const code = codeLines.join("\n");
    const isJson = codeLanguage === "json" || (!codeLanguage && parseJson(code) !== undefined);
    blocks.push(<pre className="conversation-trace-markdown-code" key={`code:${blocks.length}`}>{isJson ? <JsonCode value={code} /> : code}</pre>);
    codeLines = undefined;
    codeLanguage = "";
  };
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      if (codeLines) flushCode();
      else { codeLines = []; codeLanguage = line.trim().slice(3).trim().toLowerCase(); }
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

function parseJson(value: string): unknown {
  const normalized = value.trim();
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) return undefined;
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return undefined;
  }
}

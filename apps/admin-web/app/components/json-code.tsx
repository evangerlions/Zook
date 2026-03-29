import { Fragment, type ReactNode } from "react";

type JsonTokenKind = "boolean" | "key" | "null" | "number" | "punctuation" | "string";

const JSON_TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g;

function resolveTokenKind(source: string, token: string, tokenEnd: number): JsonTokenKind {
  if (token.startsWith("\"")) {
    const trailingWhitespace = source.slice(tokenEnd).match(/^\s*/)?.[0].length ?? 0;
    return source[tokenEnd + trailingWhitespace] === ":" ? "key" : "string";
  }

  if (token === "true" || token === "false") {
    return "boolean";
  }

  if (token === "null") {
    return "null";
  }

  if (/^[{}\[\],:]$/.test(token)) {
    return "punctuation";
  }

  return "number";
}

function renderHighlightedJson(source: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of source.matchAll(JSON_TOKEN_PATTERN)) {
    const token = match[0];
    const tokenIndex = match.index ?? 0;

    if (tokenIndex > lastIndex) {
      parts.push(<Fragment key={`plain-${lastIndex}`}>{source.slice(lastIndex, tokenIndex)}</Fragment>);
    }

    const tokenEnd = tokenIndex + token.length;
    const tokenKind = resolveTokenKind(source, token, tokenEnd);
    parts.push(
      <span className={`json-token json-token-${tokenKind}`} key={`token-${tokenIndex}`}>
        {token}
      </span>,
    );
    lastIndex = tokenEnd;
  }

  if (lastIndex < source.length) {
    parts.push(<Fragment key={`plain-${lastIndex}`}>{source.slice(lastIndex)}</Fragment>);
  }

  return parts;
}

export function JsonCode({ value }: { value: string }) {
  const source = value || " ";

  return <code className="json-code">{renderHighlightedJson(source)}</code>;
}

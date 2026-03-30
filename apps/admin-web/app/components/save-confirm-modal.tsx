import * as Diff from "diff";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Modal } from "antd";

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

function renderHighlightedJson(source: string): ReactNode {
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

// Auto-generate change summary helpers
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shortenText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "∅";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `"${shortenText(value, 32)}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // For objects/arrays, just show type
  if (Array.isArray(value)) {
    return "[Array]";
  }
  if (typeof value === "object") {
    return "{Object}";
  }
  return String(value);
}

interface DiffChange {
  path: string;
  type: "added" | "removed" | "updated";
  before: unknown;
  after: unknown;
}

function collectObjectDiff(
  previousValue: unknown,
  nextValue: unknown,
  path: string,
  changes: DiffChange[],
  maxItems: number,
): void {
  if (changes.length >= maxItems) {
    return;
  }

  // Both are plain objects - recurse into keys
  if (isPlainObject(previousValue) && isPlainObject(nextValue)) {
    const keys = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)]);
    Array.from(keys)
      .sort()
      .forEach((key) => {
        collectObjectDiff(
          previousValue[key],
          nextValue[key],
          path ? `${path}.${key}` : key,
          changes,
          maxItems,
        );
      });
    return;
  }

  // Both are arrays - compare by index
  if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
    const maxLen = Math.max(previousValue.length, nextValue.length);
    for (let i = 0; i < maxLen && changes.length < maxItems; i++) {
      collectObjectDiff(
        previousValue[i],
        nextValue[i],
        `${path}[${i}]`,
        changes,
        maxItems,
      );
    }
    return;
  }

  // Same value - no change
  if (isSameValue(previousValue, nextValue)) {
    return;
  }

  // Determine change type
  if (previousValue === undefined) {
    // Added
    changes.push({ path: path || "(root)", type: "added", before: undefined, after: nextValue });
  } else if (nextValue === undefined) {
    // Removed
    changes.push({ path: path || "(root)", type: "removed", before: previousValue, after: undefined });
  } else {
    // Updated
    changes.push({ path: path || "(root)", type: "updated", before: previousValue, after: nextValue });
  }
}

export function buildChangeSummary(previousValue: unknown, nextValue: unknown): string {
  const maxItems = 10;
  const changes: DiffChange[] = [];
  collectObjectDiff(previousValue, nextValue, "", changes, maxItems);

  if (!changes.length) {
    return "更新配置";
  }

  const lines = changes.slice(0, maxItems).map((item) => {
    if (item.type === "added") {
      return `[ADD] ${item.path}: ${formatDiffValue(item.after)}`;
    }
    if (item.type === "removed") {
      return `[DEL] ${item.path}`;
    }
    return `${item.path}: ${formatDiffValue(item.before)} -> ${formatDiffValue(item.after)}`;
  });

  if (changes.length > maxItems) {
    lines.push(`... 等 ${changes.length} 项变更`);
  }

  return lines.join("\n");
}

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  value: string;
  lineNumber?: number;
}

function computeDiffLines(oldValue: string, newValue: string): DiffLine[] {
  const changes = Diff.diffLines(oldValue, newValue);
  const lines: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const changeLines = change.value.split("\n");
    // Remove the last empty line from split
    if (changeLines[changeLines.length - 1] === "") {
      changeLines.pop();
    }

    for (const line of changeLines) {
      if (change.added) {
        lines.push({ type: "added", value: line, lineNumber: newLineNum });
        newLineNum++;
      } else if (change.removed) {
        lines.push({ type: "removed", value: line, lineNumber: oldLineNum });
        oldLineNum++;
      } else {
        lines.push({ type: "unchanged", value: line, lineNumber: newLineNum });
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  return lines;
}

function JsonDiffView({ oldValue, newValue }: { oldValue: string; newValue: string }) {
  const diffLines = computeDiffLines(oldValue, newValue);

  if (diffLines.length === 0) {
    return <div className="json-diff-empty">没有变化</div>;
  }

  const hasChanges = diffLines.some((line) => line.type !== "unchanged");

  if (!hasChanges) {
    return <div className="json-diff-empty">内容未修改，无需对比</div>;
  }

  return (
    <div className="json-diff-view">
      <div className="json-diff-content">
        {diffLines.map((line, index) => (
          <div
            className={`json-diff-line json-diff-line-${line.type}`}
            key={`diff-${index}`}
          >
            <span className="json-diff-gutter">
              <span className="json-diff-line-num">{line.lineNumber}</span>
              <span className="json-diff-marker">
                {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              </span>
            </span>
            <span className="json-diff-value">
              {line.value ? renderHighlightedJson(line.value) : " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SaveConfirmModalProps {
  open: boolean;
  oldValue: string;
  newValue: string;
  desc: string;
  onDescChange: (desc: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  title?: string;
  descPlaceholder?: string;
}

export function SaveConfirmModal({
  open,
  oldValue,
  newValue,
  desc,
  onDescChange,
  onConfirm,
  onCancel,
  loading = false,
  title = "保存确认",
  descPlaceholder = "例如：新增投递渠道白名单",
}: SaveConfirmModalProps) {
  // Auto-generate change summary when modal opens
  useEffect(() => {
    if (open) {
      try {
        const previous = JSON.parse(oldValue);
        const next = JSON.parse(newValue);
        const summary = buildChangeSummary(previous, next);
        onDescChange(summary);
      } catch {
        // Ignore parse errors
      }
    }
  }, [open, oldValue, newValue]);
  return (
    <Modal
      cancelText="取消"
      okButtonProps={{ loading }}
      okText="确认保存"
      onCancel={onCancel}
      onOk={onConfirm}
      open={open}
      title={title}
      width={720}
    >
      <div className="save-confirm-modal-content">
        <label className="field">
          <span className="field-label">更新说明</span>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 6 }}
            onChange={(event) => onDescChange(event.target.value)}
            placeholder={descPlaceholder}
            value={desc}
          />
          <small className="field-hint">会进入版本历史，后续回滚时也能看见。</small>
        </label>

        <div className="json-diff-section">
          <div className="json-diff-section-header">
            <h4>变更对比</h4>
            <p>以下显示修改前后的 JSON 差异（红色为删除，绿色为新增）。</p>
          </div>
          <JsonDiffView oldValue={oldValue} newValue={newValue} />
        </div>
      </div>
    </Modal>
  );
}
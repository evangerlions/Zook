import { Button } from "antd";

import { formatTimestamp } from "../lib/format";
import type { ConfigRevisionMeta } from "../lib/types";

export function RevisionList({
  revisions,
  activeRevision,
  loadingRevision,
  onSelect,
  onRestore,
  compact = false,
}: {
  revisions: ConfigRevisionMeta[];
  activeRevision?: number;
  loadingRevision?: number | null;
  onSelect: (revision: number) => void;
  onRestore?: (revision: number) => void;
  compact?: boolean;
}) {
  if (!revisions.length) {
    return <p className="empty-inline">还没有版本记录。</p>;
  }

  return (
    <div className={`revision-list${compact ? " is-compact" : ""}`}>
      {revisions.map((item) => (
        <article className={`revision-item${compact ? " is-compact" : ""}`} key={item.revision}>
          <div>
            <strong>R{item.revision}</strong>
            <p>{item.desc || "未填写说明"}</p>
            <small>{formatTimestamp(item.createdAt)}</small>
          </div>
          <div className="revision-actions">
            <Button onClick={() => onSelect(item.revision)} type="default">
              {activeRevision === item.revision ? "当前查看" : "查看"}
            </Button>
            {onRestore ? (
              <Button
                danger
                disabled={loadingRevision === item.revision}
                onClick={() => onRestore(item.revision)}
                type="primary"
              >
                {loadingRevision === item.revision ? "恢复中..." : "恢复"}
              </Button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

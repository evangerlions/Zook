import { EyeOutlined, RollbackOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";

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
          <div className="revision-item-head">
            <div className="revision-item-title">
              <strong>R{item.revision}</strong>
              {activeRevision === item.revision ? <span className="meta-chip">当前查看</span> : null}
            </div>
            <div className="revision-actions">
              <Tooltip title={activeRevision === item.revision ? "正在查看这个版本" : "查看这个版本"}>
                <span>
                  <Button
                    aria-label={`查看版本 R${item.revision}`}
                    className="action-icon-button"
                    icon={<EyeOutlined />}
                    onClick={() => onSelect(item.revision)}
                    shape="circle"
                    type={activeRevision === item.revision ? "primary" : "default"}
                  />
                </span>
              </Tooltip>
              {onRestore ? (
                <Tooltip title={loadingRevision === item.revision ? "恢复中" : `恢复到版本 R${item.revision}`}>
                  <span>
                    <Button
                      aria-label={`恢复到版本 R${item.revision}`}
                      className="action-icon-button"
                      danger
                      disabled={loadingRevision === item.revision}
                      icon={<RollbackOutlined />}
                      loading={loadingRevision === item.revision}
                      onClick={() => onRestore(item.revision)}
                      shape="circle"
                      type="default"
                    />
                  </span>
                </Tooltip>
              ) : null}
            </div>
          </div>
          <p className="revision-desc">{item.desc || "未填写说明"}</p>
          <small>{formatTimestamp(item.createdAt)}</small>
        </article>
      ))}
    </div>
  );
}

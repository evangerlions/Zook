import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { ReactNode } from "react";

export function RevisionHistoryDock({
  expanded,
  onToggle,
  children,
  title = "版本历史",
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  title?: string;
}) {
  if (!expanded) {
    return (
      <aside className="history-dock-collapsed" aria-label={title}>
        <Tooltip title={`展开${title}`}>
          <span>
            <Button
              aria-label={`展开${title}`}
              className="history-dock-toggle"
              icon={<LeftOutlined />}
              onClick={onToggle}
              shape="circle"
              type="default"
            />
          </span>
        </Tooltip>
        <span className="history-dock-collapsed-label">{title}</span>
      </aside>
    );
  }

  return (
    <aside className="side-card side-card--history">
      <div className="history-dock-header">
        <div>
          <h3>{title}</h3>
          <p>需要时再展开回看和回滚，平时尽量把空间留给编辑区。</p>
        </div>
        <Tooltip title={`收起${title}`}>
          <span>
            <Button
              aria-label={`收起${title}`}
              className="history-dock-toggle"
              icon={<RightOutlined />}
              onClick={onToggle}
              shape="circle"
              type="default"
            />
          </span>
        </Tooltip>
      </div>

      {children}
    </aside>
  );
}

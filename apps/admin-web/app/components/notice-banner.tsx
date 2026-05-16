import { Alert } from "antd";

import type { NoticeState } from "../lib/types";

export function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: NoticeState | null;
  onDismiss?: () => void;
}) {
  if (!notice) {
    return null;
  }

  return (
    <Alert
      className="notice-banner"
      closable={Boolean(onDismiss)}
      message={notice.text}
      onClose={onDismiss}
      showIcon
      type={notice.tone === "error" ? "error" : notice.tone === "success" ? "success" : "info"}
    />
  );
}

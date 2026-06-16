import type {
  AdminFeedbackAttachment,
  AdminFeedbackAttachmentContentDocument,
  AdminFeedbackItem,
  FeedbackStatus,
} from "./types";

export const FEEDBACK_STATUS_OPTIONS: Array<{ value: FeedbackStatus; label: string; color: string }> = [
  { value: "new", label: "新反馈", color: "blue" },
  { value: "doing", label: "处理中", color: "gold" },
  { value: "done", label: "已完成", color: "green" },
];

export function feedbackMessagePreview(message: string, maxLength = 96): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

export function feedbackAttachmentLabel(count: number): string {
  return count > 0 ? `${count} 张图片` : "无图片";
}

export function feedbackAttachmentDataUrl(
  attachment: AdminFeedbackAttachmentContentDocument,
): string {
  return `data:${attachment.mimeType};base64,${attachment.contentBase64}`;
}

export function feedbackAttachmentMeta(attachment: AdminFeedbackAttachment): string {
  const dimensions = attachment.width && attachment.height
    ? `${attachment.width}×${attachment.height}`
    : "未知尺寸";
  return `${attachment.mimeType} · ${dimensions} · ${formatBytes(attachment.sizeBytes)}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function feedbackUserLabel(item: AdminFeedbackItem): string {
  return item.userEmail || item.userId;
}

export function feedbackStatusLabel(status: FeedbackStatus): string {
  return FEEDBACK_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
}

export function feedbackStatusColor(status: FeedbackStatus): string {
  return FEEDBACK_STATUS_OPTIONS.find((item) => item.value === status)?.color ?? "default";
}

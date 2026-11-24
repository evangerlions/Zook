import type {
  AdminFeedbackAttachment,
  AdminFeedbackAttachmentContentDocument,
  AdminFeedbackImage,
  AdminFeedbackItem,
  FeedbackStatus,
} from "./types";

export const FEEDBACK_STATUS_OPTIONS: Array<{ value: FeedbackStatus; label: string; color: string }> = [
  { value: "new", label: "新反馈", color: "blue" },
  { value: "doing", label: "处理中", color: "gold" },
  { value: "done", label: "已结单", color: "green" },
];

export const FEEDBACK_REPLY_PRESETS = [
  { label: "收到建议 · 回复 1", message: "感谢您给我们留言！我们会认真考虑您的建议。" },
  { label: "收到建议 · 回复 2", message: "感谢您给我们留言！我们已将其记录在需求池中。" },
  { label: "已确认会改", message: "谢谢您指出这个问题。我们会在后续更新里改进。" },
  { label: "需要补充信息", message: "方便说一下，您是在做哪一步时遇到这个问题的吗？手头有截图的话，也可以发给我们看看。" },
  { label: "已处理", message: "这个问题已经处理好了，您可以再试一下。如果还会遇到，直接在这里告诉我们就行。" },
];

const MAX_REPLY_IMAGE_COUNT = 20;
const MAX_REPLY_IMAGE_BYTES = 10 * 1024 * 1024;

export function feedbackReplyImageLimitError(files: readonly { size?: number }[]): string | undefined {
  if (files.length > MAX_REPLY_IMAGE_COUNT) return "一次回复最多发送 20 张图片。";
  if (files.reduce((total, file) => total + (file.size ?? 0), 0) > MAX_REPLY_IMAGE_BYTES) {
    return "一次回复的图片总大小不能超过 10 MB。";
  }
  return undefined;
}

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

export function feedbackAttachmentMeta(attachment: AdminFeedbackImage | AdminFeedbackAttachment): string {
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

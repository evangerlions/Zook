export type FeedbackStatus = "new" | "doing" | "done";

export interface AdminFeedbackAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface AdminFeedbackItem {
  id: string;
  appId: string;
  userId: string;
  userEmail?: string;
  userAgent?: string;
  message: string;
  status: FeedbackStatus;
  platform?: string;
  appVersion?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
  logTask?: { taskId: string; status: string; hasFile: boolean; did?: string };
  attachmentCount: number;
  attachments: AdminFeedbackAttachment[];
  createdAt: string;
  updatedAt: string;
  needsReply?: boolean;
}

export interface AdminFeedbackListDocument {
  app: "ai_novel";
  items: AdminFeedbackItem[];
}

export interface AdminFeedbackStatusUpdateDocument {
  app: "ai_novel";
  id: string;
  status: FeedbackStatus;
  updatedAt: string;
}

export interface AdminFeedbackAttachmentContentDocument
  extends AdminFeedbackAttachment {
  feedbackId: string;
  contentBase64: string;
}

export type AdminFeedbackImage = Pick<AdminFeedbackAttachment,
  "id" | "fileName" | "mimeType" | "sizeBytes" | "width" | "height">;

export interface AdminFeedbackMessage {
  id: string;
  sender: "user" | "support";
  message: string;
  createdAt: string;
  attachments: AdminFeedbackImage[];
}

export interface AdminFeedbackThread {
  id: string;
  messages: AdminFeedbackMessage[];
  nextCursor?: string;
}

export interface AdminFeedbackReplyImage {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes: number;
}

export interface AdminFeedbackReply {
  message?: string;
  attachments?: AdminFeedbackReplyImage[];
  submissionKey: string;
  close?: boolean;
}

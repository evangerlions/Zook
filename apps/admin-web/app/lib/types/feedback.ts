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
  message: string;
  status: FeedbackStatus;
  platform?: string;
  appVersion?: string;
  locale?: string;
  attachmentCount: number;
  attachments: AdminFeedbackAttachment[];
  createdAt: string;
  updatedAt: string;
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

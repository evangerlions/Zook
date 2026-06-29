import type { FeedbackAttachmentRecord, FeedbackRecord } from "./records.ts";

export interface FeedbackAttachmentInput {
  fileName?: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
}

export interface FeedbackSubmitDocument {
  accepted: true;
  id: string;
  attachmentCount: number;
}

export interface AdminFeedbackAttachmentDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface AdminFeedbackItemDocument {
  id: string;
  appId: string;
  userId: string;
  userEmail?: string;
  message: string;
  status: FeedbackRecord["status"];
  platform?: string;
  appVersion?: string;
  locale?: string;
  attachmentCount: number;
  attachments: AdminFeedbackAttachmentDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminFeedbackListDocument {
  app: "ai_novel";
  items: AdminFeedbackItemDocument[];
}

export interface AdminFeedbackStatusUpdateDocument {
  app: "ai_novel";
  id: string;
  status: FeedbackRecord["status"];
  updatedAt: string;
}

export interface AdminFeedbackAttachmentContentDocument
  extends Pick<
    FeedbackAttachmentRecord,
    "id" | "feedbackId" | "fileName" | "mimeType" | "sizeBytes" | "width" | "height"
  > {
  contentBase64: string;
}

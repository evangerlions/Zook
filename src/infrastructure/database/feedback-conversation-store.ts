import type { FeedbackAttachmentRecord, FeedbackRecord } from "../../shared/types.ts";
type MaybePromise<T> = T | Promise<T>;

export interface FeedbackConversationRecord extends FeedbackRecord {
  conversationUpdatedAt?: string;
  needsReply: boolean;
  lastSupportMessage: number;
  readSupportMessage: number;
}

export type FeedbackReplySender = "user" | "support";

export interface FeedbackReplyRecord {
  id: string;
  feedbackId: string;
  sender: FeedbackReplySender;
  message: string;
  createdAt: string;
  sequence: number;
}

export interface FeedbackReplyWrite extends Omit<FeedbackReplyRecord, "sequence"> {
  submissionKey: string;
  fingerprint: string;
}

export interface FeedbackPageBoundary {
  time: string;
  id: string;
}

export type FeedbackReplyWriteResult =
  | { kind: "saved"; id: string }
  | { kind: "replayed"; id: string }
  | { kind: "missing" }
  | { kind: "conflict" };

export class FeedbackReplyWriteRolledBackError extends Error {
  constructor(cause: unknown) {
    super("Feedback reply write rolled back.", { cause });
  }
}

export interface FeedbackConversationStore {
  find(appId: string, id: string, userId?: string): MaybePromise<FeedbackConversationRecord | undefined>;
  list(appId: string, userId: string, limit: number, before?: FeedbackPageBoundary): MaybePromise<FeedbackConversationRecord[]>;
  hasAttachmentStoragePath(appId: string, storagePath: string): MaybePromise<boolean>;
  hasUnread(appId: string, userId: string): MaybePromise<boolean>;
  listReplies(id: string, limit: number, before?: number): MaybePromise<FeedbackReplyRecord[]>;
  findSubmission(id: string, sender: FeedbackReplySender, submissionKey: string): MaybePromise<{ id: string; fingerprint: string } | undefined>;
  listReplyAttachments(replyIds: string[]): MaybePromise<FeedbackAttachmentRecord[]>;
  append(appId: string, ownerId: string, reply: FeedbackReplyWrite, attachments: FeedbackAttachmentRecord[], close: boolean): MaybePromise<FeedbackReplyWriteResult>;
  markRead(appId: string, id: string, ownerId: string, messageId: string): MaybePromise<boolean>;
}

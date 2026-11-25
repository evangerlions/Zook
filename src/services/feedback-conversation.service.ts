import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import {
  FeedbackReplyWriteRolledBackError,
  type FeedbackConversationRecord,
  type FeedbackPageBoundary,
  type FeedbackReplySender,
  type FeedbackReplyWrite,
  type FeedbackReplyWriteResult,
} from "../infrastructure/database/feedback-conversation-store.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { PersistentFileStore } from "../infrastructure/files/persistent-file-store.ts";
import { ApplicationError, badRequest, payloadTooLarge } from "../shared/errors.ts";
import type {
  AdminFeedbackAttachmentContentDocument,
  FeedbackAttachmentRecord,
  FeedbackConversationDocument,
  FeedbackConversationListDocument,
  FeedbackConversationMessage,
} from "../shared/types.ts";
import { randomId, sha256 } from "../shared/utils.ts";
import { parseFeedbackAttachment, readFeedbackAttachment, removeFeedbackAttachments, saveFeedbackAttachments } from "./feedback-attachments.ts";
import type { FeedbackReplyLimiter } from "./feedback-reply-limiter.ts";

const APP_ID = "ai_novel";
const PAGE_SIZE = 50;
const MAX_REPLY_MESSAGE_BYTES = 16 * 1024;
const MAX_REPLY_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REPLY_IMAGES = 20;

type FeedbackWriter = { sender: "user"; userId: string } | { sender: "support" };

interface ReplyInput {
  message?: unknown;
  attachments?: unknown;
  submissionKey?: unknown;
  close?: unknown;
}

function notFound(): never {
  throw new ApplicationError(404, "REQ_INVALID_BODY", "Feedback was not found.");
}

function activity(record: FeedbackConversationRecord): string {
  return record.conversationUpdatedAt ?? record.createdAt;
}

function parseListCursor(cursor: string | undefined): FeedbackPageBoundary | undefined {
  if (cursor === undefined) return undefined;
  const [time, id, extra] = cursor.split("|");
  if (!time || !id || extra !== undefined || !/^feedback_[a-zA-Z0-9]+$/.test(id) ||
      !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) {
    badRequest("REQ_INVALID_QUERY", "Invalid feedback cursor.");
  }
  return { time, id };
}

function parseMessageCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return undefined;
  const sequence = Number(cursor);
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(sequence) || sequence < 1) {
    badRequest("REQ_INVALID_QUERY", "Invalid feedback message cursor.");
  }
  return sequence;
}

function parseReply(input: ReplyInput, sender: FeedbackReplySender) {
  if (input.message !== undefined && typeof input.message !== "string") {
    badRequest("REQ_INVALID_BODY", "Feedback reply message must be text.");
  }
  const message = (input.message ?? "").trim();
  if (Buffer.byteLength(message) > MAX_REPLY_MESSAGE_BYTES) {
    payloadTooLarge("REQ_INVALID_BODY", "Feedback reply message is too large.");
  }
  const attachments = input.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > MAX_REPLY_IMAGES || (!message && !attachments.length)) {
    badRequest("REQ_INVALID_BODY", "Feedback reply must contain text or images.");
  }
  if (typeof input.submissionKey !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(input.submissionKey)) {
    badRequest("REQ_INVALID_BODY", "Invalid feedback reply submission key.");
  }
  if (input.close !== undefined && (sender !== "support" || typeof input.close !== "boolean")) {
    badRequest("REQ_INVALID_BODY", "Invalid feedback reply close value.");
  }
  return { message, attachments, submissionKey: input.submissionKey, close: input.close === true };
}

function attachmentSummary({ id, fileName, mimeType, sizeBytes }: FeedbackAttachmentRecord) {
  return { id, fileName, mimeType, sizeBytes };
}

export class FeedbackConversationService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly files: PersistentFileStore,
    private readonly limiter: FeedbackReplyLimiter,
    private readonly logger: StructuredLogger,
  ) {}

  async list(userId: string, cursor: string | undefined): Promise<FeedbackConversationListDocument> {
    const store = this.database.getFeedbackConversationStore();
    const before = parseListCursor(cursor);
    const [rows, hasUnread] = await Promise.all([
      store.list(APP_ID, userId, PAGE_SIZE + 1, before), store.hasUnread(APP_ID, userId),
    ]);
    const visible = rows.slice(0, PAGE_SIZE);
    const last = rows.length > PAGE_SIZE ? visible.at(-1) : undefined;
    return {
      items: visible.map(row => ({
        id: row.id,
        message: [...row.message.slice(0, 320)].slice(0, 160).join(""),
        updatedAt: activity(row),
        unread: row.lastSupportMessage > row.readSupportMessage,
      })),
      hasUnread,
      ...(last ? { nextCursor: `${activity(last)}|${last.id}` } : {}),
    };
  }

  async detail(id: string, userId: string | undefined, cursor: string | undefined): Promise<FeedbackConversationDocument> {
    const before = parseMessageCursor(cursor);
    const row = await this.requireConversation(id, userId);
    const store = this.database.getFeedbackConversationStore();
    const rows = await store.listReplies(id, PAGE_SIZE + 1, before);
    const visible = rows.slice(0, PAGE_SIZE);
    const attachments = await store.listReplyAttachments(visible.map(reply => reply.id));
    const messages: FeedbackConversationMessage[] = visible.toReversed().map(reply => ({
      id: reply.id,
      sender: reply.sender,
      message: reply.message,
      createdAt: reply.createdAt,
      attachments: attachments.filter(file => file.replyId === reply.id).map(attachmentSummary),
    }));
    const last = rows.length > PAGE_SIZE ? visible.at(-1) : undefined;
    if (!last) {
      const original = await this.database.listFeedbackAttachments([id]);
      messages.unshift({
        id,
        sender: "user",
        message: row.message,
        createdAt: row.createdAt,
        attachments: original.map(attachmentSummary),
      });
    }
    return { id, messages, ...(last ? { nextCursor: String(last.sequence) } : {}) };
  }

  async send(id: string, writer: FeedbackWriter, input: ReplyInput): Promise<{ id: string; replayed: boolean }> {
    const command = parseReply(input, writer.sender);
    if (writer.sender === "user") await this.limiter.admitRequest(writer.userId);
    const row = await this.requireConversation(id, writer.sender === "user" ? writer.userId : undefined);
    const store = this.database.getFeedbackConversationStore();
    const prior = await store.findSubmission(id, writer.sender, command.submissionKey);
    if (!prior && writer.sender === "user") {
      await this.limiter.consume(writer.userId, id, command.submissionKey, {
        text: command.message ? 1 : 0,
        images: command.attachments.length,
      });
    }
    const attachments = command.attachments.map((item, index) => parseFeedbackAttachment(item, index, MAX_REPLY_IMAGE_BYTES, true));
    if (attachments.reduce((total, file) => total + file.sizeBytes, 0) > MAX_REPLY_IMAGE_BYTES) {
      payloadTooLarge("REQ_INVALID_BODY", "Feedback reply images are too large.");
    }
    const fingerprint = sha256(JSON.stringify({
      message: command.message,
      close: command.close,
      attachments: attachments.map(({ fileName, mimeType, content }) => ({
        fileName, mimeType, hash: createHash("sha256").update(content).digest("hex"),
      })),
    }));
    if (prior) {
      if (prior.fingerprint !== fingerprint) badRequest("REQ_INVALID_BODY", "Feedback reply key was reused with different content.");
      return { id: prior.id, replayed: true };
    }

    const replyId = randomId("fb_reply");
    const createdAt = new Date().toISOString();
    const files = await saveFeedbackAttachments(this.files, row, attachments, createdAt, replyId);
    const result = await this.persistReply(row.userId, {
      id: replyId, feedbackId: id, sender: writer.sender, message: command.message,
      submissionKey: command.submissionKey, fingerprint, createdAt,
    }, files, command.close);
    if (result.kind !== "saved") await removeFeedbackAttachments(this.files, files);
    if (result.kind === "missing") notFound();
    if (result.kind === "conflict") badRequest("REQ_INVALID_BODY", "Feedback reply key was reused with different content.");
    if (result.kind === "saved") {
      this.logger.info("Feedback reply saved", {
        feedbackId: id, replyId: result.id, sender: writer.sender,
        attachmentCount: files.length, closed: command.close,
      });
    }
    return { id: result.id, replayed: result.kind === "replayed" };
  }

  private async persistReply(
    ownerId: string,
    reply: FeedbackReplyWrite,
    files: FeedbackAttachmentRecord[],
    close: boolean,
  ): Promise<FeedbackReplyWriteResult> {
    const store = this.database.getFeedbackConversationStore();
    try {
      return await store.append(APP_ID, ownerId, reply, files, close);
    } catch (error) {
      if (error instanceof FeedbackReplyWriteRolledBackError) {
        await removeFeedbackAttachments(this.files, files);
        throw error;
      }
      // A lost connection can hide a committed reply. Retain referenced files
      // unless the database proved rollback or a different reply won this key.
      const persisted = await Promise.resolve(store.findSubmission(reply.feedbackId, reply.sender, reply.submissionKey)).catch(() => undefined);
      if (!persisted) {
        this.logger.warn("Feedback reply write was not acknowledged", { feedbackId: reply.feedbackId, replyId: reply.id, attachmentCount: files.length });
        throw error;
      }
      if (persisted.id === reply.id) return { kind: "saved", id: reply.id };
      return persisted.fingerprint === reply.fingerprint
        ? { kind: "replayed", id: persisted.id } : { kind: "conflict" };
    }
  }

  async markRead(id: string, userId: string, messageId: string): Promise<{ read: true }> {
    const marked = await this.database.getFeedbackConversationStore().markRead(APP_ID, id, userId, messageId);
    if (!marked) notFound();
    return { read: true };
  }

  async readAttachment(id: string, attachmentId: string, userId: string): Promise<AdminFeedbackAttachmentContentDocument> {
    await this.requireConversation(id, userId);
    const attachment = await this.database.findFeedbackAttachment(APP_ID, id, attachmentId);
    if (!attachment) notFound();
    return await readFeedbackAttachment(this.files, attachment);
  }

  private async requireConversation(id: string, userId?: string): Promise<FeedbackConversationRecord> {
    const row = await this.database.getFeedbackConversationStore().find(APP_ID, id, userId);
    if (!row) notFound();
    return row;
  }
}

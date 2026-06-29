import { extname } from "node:path";
import { ApplicationError, badRequest, payloadTooLarge, tooManyRequests } from "../shared/errors.ts";
import type {
  AdminFeedbackAttachmentContentDocument,
  AdminFeedbackItemDocument,
  AdminFeedbackListDocument,
  AdminFeedbackStatusUpdateDocument,
  AuthContext,
  FeedbackAttachmentInput,
  FeedbackAttachmentRecord,
  FeedbackRecord,
  FeedbackSubmitDocument,
} from "../shared/types.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { PersistentFileStore } from "../infrastructure/files/persistent-file-store.ts";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "../shared/types/records.ts";
import { randomId, sha256, toDateKey } from "../shared/utils.ts";

const AI_NOVEL_APP_ID = "ai_novel";
const MAX_MESSAGE_CHARS = 10_000;
const MIN_MESSAGE_CHARS = 30;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_USER_IMAGE_BYTES_PER_DAY = 25 * 1024 * 1024;
const USER_HOURLY_LIMIT = 5;
const USER_DAILY_LIMIT = 20;
const IP_HOURLY_LIMIT = 20;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface SubmitFeedbackCommand {
  auth: AuthContext;
  message: unknown;
  attachments: unknown;
  ipAddress?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

interface ParsedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  sizeBytes: number;
  width?: number;
  height?: number;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLimit(limit?: unknown): number {
  const value = typeof limit === "number" ? limit : Number(limit);
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 500)) : 100;
}

function parseFeedbackStatus(value: unknown, options: { required: boolean }): FeedbackStatus | undefined {
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      badRequest("REQ_INVALID_BODY", "Feedback status is required.");
    }
    return undefined;
  }
  if (typeof value !== "string" || !FEEDBACK_STATUSES.includes(value as FeedbackStatus)) {
    badRequest("REQ_INVALID_BODY", "Feedback status must be new, doing, or done.");
  }
  return value as FeedbackStatus;
}

function sanitizeFileName(fileName: string, fallback: string): string {
  const leaf = fileName.trim().split(/[\\/]/).pop() ?? "";
  return leaf.replace(/[^a-zA-Z0-9._-]/g, "_") || fallback;
}

function extForMime(mimeType: string): string {
  const ext = IMAGE_MIME_EXTENSIONS[mimeType];
  if (!ext) {
    badRequest("REQ_INVALID_BODY", "Unsupported feedback image type.");
  }
  return ext;
}

function hasImageSignature(content: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return content.length >= 12 &&
      content.subarray(0, 4).toString("ascii") === "RIFF" &&
      content.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function parseAttachment(input: unknown, index: number): ParsedAttachment {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    badRequest("REQ_INVALID_BODY", "Each feedback attachment must be an object.");
  }
  const item = input as FeedbackAttachmentInput;
  const mimeType = typeof item.mimeType === "string" ? item.mimeType.trim().toLowerCase() : "";
  const ext = extForMime(mimeType);
  const contentBase64 = typeof item.contentBase64 === "string" ? item.contentBase64.trim() : "";
  if (!contentBase64) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment content is required.");
  }

  let content: Buffer;
  try {
    content = Buffer.from(contentBase64, "base64");
  } catch {
    badRequest("REQ_INVALID_BODY", "Feedback attachment content must be base64.");
  }
  if (content.length === 0) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment content is empty.");
  }
  if (content.length > MAX_ATTACHMENT_BYTES) {
    payloadTooLarge("REQ_INVALID_BODY", "Feedback attachment is too large.");
  }
  if (typeof item.sizeBytes !== "number" || !Number.isFinite(item.sizeBytes)) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment size is required.");
  }
  if (item.sizeBytes !== content.length) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment size does not match content.");
  }
  if (!hasImageSignature(content, mimeType)) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment content does not match image type.");
  }

  const id = randomId("fb_att");
  const rawName = typeof item.fileName === "string" ? item.fileName.trim() : "";
  if (!rawName) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment file name is required.");
  }
  const fileName = sanitizeFileName(rawName, `feedback-${index + 1}.${ext}`);
  const fileExt = extname(fileName).replace(".", "").toLowerCase();
  const normalizedFileName = fileExt ? fileName : `${fileName}.${ext}`;

  return {
    id,
    fileName: normalizedFileName,
    mimeType,
    content,
    sizeBytes: content.length,
    width: typeof item.width === "number" && Number.isFinite(item.width) ? Math.floor(item.width) : undefined,
    height: typeof item.height === "number" && Number.isFinite(item.height) ? Math.floor(item.height) : undefined,
  };
}

export class FeedbackService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly fileStore: PersistentFileStore,
  ) {}

  async submit(command: SubmitFeedbackCommand): Promise<FeedbackSubmitDocument> {
    return await this.database.withExclusiveSession(async () => await this.doSubmit(command));
  }

  private async doSubmit(command: SubmitFeedbackCommand): Promise<FeedbackSubmitDocument> {
    if (command.auth.appId !== AI_NOVEL_APP_ID) {
      badRequest("AUTH_APP_SCOPE_MISMATCH", "Feedback can only be submitted from ai_novel.");
    }

    const message = typeof command.message === "string" ? command.message.trim() : "";
    if (!message) {
      badRequest("REQ_INVALID_BODY", "Feedback content is required.");
    }
    const messageLength = [...message].length;
    if (messageLength < MIN_MESSAGE_CHARS) {
      badRequest("REQ_INVALID_BODY", "Feedback content must be at least 30 characters.");
    }
    if (messageLength > MAX_MESSAGE_CHARS) {
      badRequest("REQ_INVALID_BODY", "Feedback content is too long.");
    }

    const rawAttachments = command.attachments === undefined ? [] : command.attachments;
    if (!Array.isArray(rawAttachments)) {
      badRequest("REQ_INVALID_BODY", "Feedback attachments must be an array.");
    }
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      badRequest("REQ_INVALID_BODY", "Feedback supports at most 5 images.");
    }
    const attachments = rawAttachments.map(parseAttachment);
    const totalAttachmentBytes = attachments.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      payloadTooLarge("REQ_INVALID_BODY", "Feedback images are too large.");
    }

    const ipHash = command.ipAddress?.trim() ? sha256(command.ipAddress.trim()) : undefined;
    const messageHash = sha256(normalizeMessage(message).toLowerCase());
    await this.enforceAbuseLimits({
      appId: command.auth.appId,
      userId: command.auth.userId,
      ipHash,
      messageHash,
      totalAttachmentBytes,
    });

    const now = new Date().toISOString();
    const feedbackId = randomId("feedback");
    const dateKey = toDateKey(now);
    const attachmentRecords: FeedbackAttachmentRecord[] = [];
    for (const attachment of attachments) {
      const ext = extForMime(attachment.mimeType);
      const storagePath =
        `feedback/${command.auth.appId}/${dateKey}/${feedbackId}/${attachment.id}.${ext}`;
      await this.fileStore.writeBuffer(storagePath, attachment.content);
      attachmentRecords.push({
        id: attachment.id,
        feedbackId,
        appId: command.auth.appId,
        userId: command.auth.userId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
        storagePath,
        createdAt: now,
      });
    }

    const record: FeedbackRecord = {
      id: feedbackId,
      appId: command.auth.appId,
      userId: command.auth.userId,
      message,
      messageHash,
      status: "new",
      platform: command.platform,
      appVersion: command.appVersion,
      locale: command.locale,
      ipHash,
      userAgent: command.userAgent,
      metadata: command.metadata ?? {},
      attachmentCount: attachmentRecords.length,
      createdAt: now,
      updatedAt: now,
    };
    await this.database.insertFeedback(record, attachmentRecords);
    return {
      accepted: true,
      id: feedbackId,
      attachmentCount: attachmentRecords.length,
    };
  }

  async listAdminFeedback(input: {
    limit?: unknown;
    status?: unknown;
  } = {}): Promise<AdminFeedbackListDocument> {
    const records = await this.database.listFeedbackRecords({
      appId: AI_NOVEL_APP_ID,
      status: parseFeedbackStatus(input.status, { required: false }),
      limit: normalizeLimit(input.limit),
    });
    const attachments = await this.database.listFeedbackAttachments(records.map((item) => item.id));
    const attachmentGroups = new Map<string, FeedbackAttachmentRecord[]>();
    for (const attachment of attachments) {
      const group = attachmentGroups.get(attachment.feedbackId) ?? [];
      group.push(attachment);
      attachmentGroups.set(attachment.feedbackId, group);
    }

    const items: AdminFeedbackItemDocument[] = [];
    for (const record of records) {
      const user = await this.database.findUserById(record.userId);
      items.push({
        id: record.id,
        appId: record.appId,
        userId: record.userId,
        userEmail: user?.email,
        message: record.message,
        status: record.status,
        platform: record.platform,
        appVersion: record.appVersion,
        locale: record.locale,
        attachmentCount: record.attachmentCount,
        attachments: (attachmentGroups.get(record.id) ?? []).map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          width: attachment.width,
          height: attachment.height,
          createdAt: attachment.createdAt,
        })),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    return {
      app: AI_NOVEL_APP_ID,
      items,
    };
  }

  async updateAdminFeedbackStatus(
    feedbackId: string,
    statusInput: unknown,
  ): Promise<AdminFeedbackStatusUpdateDocument> {
    const id = feedbackId.trim();
    if (!id) {
      badRequest("REQ_INVALID_BODY", "Feedback id is required.");
    }
    const status = parseFeedbackStatus(statusInput, { required: true });
    const updated = await this.database.updateFeedbackStatus(AI_NOVEL_APP_ID, id, status);
    if (!updated) {
      throw new ApplicationError(404, "REQ_INVALID_BODY", "Feedback was not found.");
    }
    return {
      app: AI_NOVEL_APP_ID,
      id: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt,
    };
  }

  async readAdminAttachment(
    feedbackId: string,
    attachmentId: string,
  ): Promise<AdminFeedbackAttachmentContentDocument> {
    const attachment = await this.database.findFeedbackAttachment(
      AI_NOVEL_APP_ID,
      feedbackId,
      attachmentId,
    );
    if (!attachment) {
      badRequest("REQ_INVALID_BODY", "Feedback attachment not found.");
    }
    const content = await this.fileStore.readBuffer(attachment.storagePath);
    return {
      id: attachment.id,
      feedbackId: attachment.feedbackId,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      width: attachment.width,
      height: attachment.height,
      contentBase64: content.toString("base64"),
    };
  }

  private async enforceAbuseLimits(input: {
    appId: string;
    userId: string;
    ipHash?: string;
    messageHash: string;
    totalAttachmentBytes: number;
  }): Promise<void> {
    const userHour = await this.database.listFeedbackRecords({
      appId: input.appId,
      userId: input.userId,
      createdAtFromIso: hoursAgo(1),
      limit: 500,
    });
    if (userHour.length >= USER_HOURLY_LIMIT) {
      tooManyRequests("AUTH_RATE_LIMITED", "Feedback submission limit reached.");
    }
    if (
      userHour.some((item) =>
        item.messageHash === input.messageHash &&
        Date.now() - new Date(item.createdAt).getTime() <= DUPLICATE_WINDOW_MS
      )
    ) {
      badRequest("REQ_INVALID_BODY", "Duplicate feedback was already submitted recently.");
    }

    const userDay = await this.database.listFeedbackRecords({
      appId: input.appId,
      userId: input.userId,
      createdAtFromIso: daysAgo(1),
      limit: 500,
    });
    if (userDay.length >= USER_DAILY_LIMIT) {
      tooManyRequests("AUTH_RATE_LIMITED", "Feedback daily submission limit reached.");
    }
    const existingAttachments = await this.database.listFeedbackAttachments(userDay.map((item) => item.id));
    const usedImageBytes = existingAttachments.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (usedImageBytes + input.totalAttachmentBytes > MAX_USER_IMAGE_BYTES_PER_DAY) {
      tooManyRequests("AUTH_RATE_LIMITED", "Feedback image daily limit reached.");
    }

    if (input.ipHash) {
      const ipHour = await this.database.listFeedbackRecords({
        appId: input.appId,
        ipHash: input.ipHash,
        createdAtFromIso: hoursAgo(1),
        limit: 500,
      });
      if (ipHour.length >= IP_HOURLY_LIMIT) {
        tooManyRequests("AUTH_RATE_LIMITED", "Feedback submission limit reached.");
      }
    }
  }
}

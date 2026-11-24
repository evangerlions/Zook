import { extname } from "node:path";
import { badRequest, payloadTooLarge } from "../shared/errors.ts";
import type { AdminFeedbackAttachmentContentDocument, FeedbackAttachmentInput, FeedbackAttachmentRecord, FeedbackRecord } from "../shared/types.ts";
import type { PersistentFileStore } from "../infrastructure/files/persistent-file-store.ts";
import { randomId, toDateKey } from "../shared/utils.ts";
import { boundedFeedbackImageDimensions } from "./feedback-image-dimensions.ts";

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface ParsedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  sizeBytes: number;
  width?: number;
  height?: number;
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

export function parseFeedbackAttachment(input: unknown, index: number, maxBytes: number, enforceDimensions = false): ParsedAttachment {
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

  if (contentBase64.length > Math.ceil(maxBytes / 3) * 4) {
    payloadTooLarge("REQ_INVALID_BODY", "Feedback attachment is too large.");
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
  if (content.length > maxBytes) {
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

  const dimensions = enforceDimensions ? boundedFeedbackImageDimensions(content, mimeType) : undefined;
  return {
    id,
    fileName: normalizedFileName,
    mimeType,
    content,
    sizeBytes: content.length,
    width: dimensions?.width ?? (typeof item.width === "number" && Number.isFinite(item.width) ? Math.floor(item.width) : undefined),
    height: dimensions?.height ?? (typeof item.height === "number" && Number.isFinite(item.height) ? Math.floor(item.height) : undefined),
  };
}

export async function saveFeedbackAttachments(
  fileStore: PersistentFileStore,
  feedback: Pick<FeedbackRecord, "id" | "appId" | "userId">,
  attachments: ParsedAttachment[],
  createdAt: string,
  replyId?: string,
): Promise<FeedbackAttachmentRecord[]> {
  const saved: FeedbackAttachmentRecord[] = [];
  try {
    for (const { content, ...attachment } of attachments) {
      const storagePath = `feedback/${feedback.appId}/${toDateKey(createdAt)}/${feedback.id}/${attachment.id}.${extForMime(attachment.mimeType)}`;
      await fileStore.writeBuffer(storagePath, content);
      saved.push({
        ...attachment,
        feedbackId: feedback.id,
        appId: feedback.appId,
        userId: feedback.userId,
        replyId,
        storagePath,
        createdAt,
      });
    }
    return saved;
  } catch (error) {
    await removeFeedbackAttachments(fileStore, saved);
    throw error;
  }
}

export async function removeFeedbackAttachments(fileStore: PersistentFileStore, files: FeedbackAttachmentRecord[]): Promise<void> {
  await Promise.allSettled(files.map(file => fileStore.removeOwnedFile(file.storagePath)));
}

export async function readFeedbackAttachment(
  fileStore: PersistentFileStore,
  { id, feedbackId, fileName, mimeType, sizeBytes, storagePath }: FeedbackAttachmentRecord,
): Promise<AdminFeedbackAttachmentContentDocument> {
  const content = await fileStore.readBuffer(storagePath);
  const dimensions = boundedFeedbackImageDimensions(content, mimeType);
  return { id, feedbackId, fileName, mimeType, sizeBytes, ...dimensions, contentBase64: content.toString("base64") };
}

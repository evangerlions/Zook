import type { QueryResult, QueryResultRow } from "pg";
import type { FeedbackAttachmentRecord, FeedbackRecord } from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

function normalizeListLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit as number), 500)) : 100;
}

function parseStatus(value: unknown): FeedbackRecord["status"] {
  if (value === "OPEN") return "new";
  if (value === "ARCHIVED") return "done";
  if (value === "new" || value === "doing" || value === "done") return value;
  throw new Error(`Unknown feedback status: ${String(value)}`);
}

function parseFeedback(row: QueryResultRow): FeedbackRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    message: String(row.message),
    messageHash: String(row.message_hash),
    status: parseStatus(row.status),
    platform: row.platform ?? undefined,
    appVersion: row.app_version ?? undefined,
    locale: row.locale ?? undefined,
    ipHash: row.ip_hash ?? undefined,
    userAgent: row.user_agent ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    attachmentCount: Number(row.attachment_count ?? 0),
    createdAt: toIsoString(row.created_at) as string,
    updatedAt: toIsoString(row.updated_at) as string,
  };
}

function parseAttachment(row: QueryResultRow): FeedbackAttachmentRecord {
  return {
    id: String(row.id),
    feedbackId: String(row.feedback_id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    width: row.width === null || row.width === undefined ? undefined : Number(row.width),
    height: row.height === null || row.height === undefined ? undefined : Number(row.height),
    storagePath: String(row.storage_path),
    createdAt: toIsoString(row.created_at) as string,
  };
}

export class PostgresFeedbackStore {
  constructor(private readonly query: PostgresQuery) {}

  async insert(record: FeedbackRecord, attachments: FeedbackAttachmentRecord[]): Promise<void> {
    await this.query(
      `INSERT INTO zook_feedback (
         id, app_id, user_id, message, message_hash, status,
         platform, app_version, locale, ip_hash, user_agent, metadata,
         attachment_count, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11, $12::jsonb,
         $13, $14::timestamptz, $15::timestamptz
       )`,
      [
        record.id,
        record.appId,
        record.userId,
        record.message,
        record.messageHash,
        record.status,
        record.platform ?? null,
        record.appVersion ?? null,
        record.locale ?? null,
        record.ipHash ?? null,
        record.userAgent ?? null,
        JSON.stringify(record.metadata),
        record.attachmentCount,
        record.createdAt,
        record.updatedAt,
      ],
    );

    for (const attachment of attachments) {
      await this.query(
        `INSERT INTO zook_feedback_attachments (
           id, feedback_id, app_id, user_id, file_name, mime_type,
           size_bytes, width, height, storage_path, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11::timestamptz
         )`,
        [
          attachment.id,
          attachment.feedbackId,
          attachment.appId,
          attachment.userId,
          attachment.fileName,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.width ?? null,
          attachment.height ?? null,
          attachment.storagePath,
          attachment.createdAt,
        ],
      );
    }
  }

  async list(filter: {
    appId: string;
    userId?: string;
    ipHash?: string;
    status?: FeedbackRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): Promise<FeedbackRecord[]> {
    const clauses = ["app_id = $1"];
    const values: unknown[] = [filter.appId];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace("?", `$${values.length}`));
    };
    if (filter.userId) add("user_id = ?", filter.userId);
    if (filter.ipHash) add("ip_hash = ?", filter.ipHash);
    if (filter.status) add("status = ?", filter.status);
    if (filter.createdAtFromIso) add("created_at >= ?::timestamptz", filter.createdAtFromIso);
    const where = `WHERE ${clauses.join(" AND ")}`;
    const limit = normalizeListLimit(filter.limit);
    const result = await this.query(
      `SELECT id, app_id, user_id, message, message_hash, status,
              platform, app_version, locale, ip_hash, user_agent, metadata,
              attachment_count, created_at, updated_at
       FROM zook_feedback
       ${where}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      values,
    );
    return result.rows.map(parseFeedback);
  }

  async updateStatus(
    appId: string,
    feedbackId: string,
    status: FeedbackRecord["status"],
  ): Promise<FeedbackRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_feedback
       SET status = $3, updated_at = NOW()
       WHERE app_id = $1 AND id = $2
       RETURNING id, app_id, user_id, message, message_hash, status,
                 platform, app_version, locale, ip_hash, user_agent, metadata,
                 attachment_count, created_at, updated_at`,
      [appId, feedbackId, status],
    );
    return result.rows[0] ? parseFeedback(result.rows[0]) : undefined;
  }

  async listAttachments(feedbackIds: string[]): Promise<FeedbackAttachmentRecord[]> {
    if (feedbackIds.length === 0) {
      return [];
    }
    const result = await this.query(
      `SELECT id, feedback_id, app_id, user_id, file_name, mime_type,
              size_bytes, width, height, storage_path, created_at
       FROM zook_feedback_attachments
       WHERE feedback_id = ANY($1::text[])
       ORDER BY created_at ASC`,
      [feedbackIds],
    );
    return result.rows.map(parseAttachment);
  }

  async findAttachment(
    appId: string,
    feedbackId: string,
    attachmentId: string,
  ): Promise<FeedbackAttachmentRecord | undefined> {
    const result = await this.query(
      `SELECT id, feedback_id, app_id, user_id, file_name, mime_type,
              size_bytes, width, height, storage_path, created_at
       FROM zook_feedback_attachments
       WHERE app_id = $1 AND feedback_id = $2 AND id = $3
       LIMIT 1`,
      [appId, feedbackId, attachmentId],
    );
    return result.rows[0] ? parseAttachment(result.rows[0]) : undefined;
  }
}

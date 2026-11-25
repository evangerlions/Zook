import pg, { type QueryResultRow } from "pg";
import { FeedbackReplyWriteRolledBackError } from "../feedback-conversation-store.ts";
import type { FeedbackAttachmentRecord } from "../../../shared/types.ts";
import type {
  FeedbackConversationRecord,
  FeedbackConversationStore,
  FeedbackPageBoundary,
  FeedbackReplyRecord,
  FeedbackReplySender,
  FeedbackReplyWrite,
  FeedbackReplyWriteResult,
} from "../feedback-conversation-store.ts";
import { parseAttachment, parseFeedback, type PostgresQuery } from "./postgres-feedback.ts";
import { toIsoString } from "./postgres-row-utils.ts";

function parseReply(row: QueryResultRow): FeedbackReplyRecord {
  return {
    id: String(row.id),
    feedbackId: String(row.feedback_id),
    sequence: Number(row.sequence),
    sender: row.sender,
    message: String(row.message),
    createdAt: toIsoString(row.created_at) as string,
  };
}

export class PostgresFeedbackConversationStore implements FeedbackConversationStore {
  constructor(private readonly query: PostgresQuery) {}

  async find(appId: string, id: string, userId?: string): Promise<FeedbackConversationRecord | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_feedback WHERE app_id = $1 AND id = $2 AND ($3::text IS NULL OR user_id = $3)",
      [appId, id, userId ?? null],
    );
    return result.rows[0] ? parseFeedback(result.rows[0]) : undefined;
  }

  async list(appId: string, userId: string, limit: number, before?: FeedbackPageBoundary): Promise<FeedbackConversationRecord[]> {
    const result = await this.query(
      `SELECT * FROM zook_feedback
       WHERE app_id = $1 AND user_id = $2 AND (
         $4::timestamptz IS NULL OR (COALESCE(conversation_updated_at, created_at), id) < ($4::timestamptz, $5::text)
       )
       ORDER BY COALESCE(conversation_updated_at, created_at) DESC, id DESC LIMIT $3`,
      [appId, userId, limit, before?.time ?? null, before?.id ?? null],
    );
    return result.rows.map(parseFeedback);
  }

  async hasAttachmentStoragePath(appId: string, storagePath: string): Promise<boolean> {
    const result = await this.query(
      "SELECT 1 FROM zook_feedback_attachments WHERE app_id = $1 AND storage_path = $2 LIMIT 1",
      [appId, storagePath],
    );
    return result.rows.length > 0;
  }

  async hasUnread(appId: string, userId: string): Promise<boolean> {
    const result = await this.query(
      `SELECT 1 FROM zook_feedback WHERE app_id = $1 AND user_id = $2
       AND last_support_message > read_support_message LIMIT 1`,
      [appId, userId],
    );
    return result.rows.length > 0;
  }

  async listReplies(id: string, limit: number, before?: number): Promise<FeedbackReplyRecord[]> {
    const result = await this.query(
      `SELECT id, feedback_id, sequence, sender, message, created_at FROM zook_feedback_replies
       WHERE feedback_id = $1 AND ($3::bigint IS NULL OR sequence < $3)
       ORDER BY sequence DESC LIMIT $2`,
      [id, limit, before ?? null],
    );
    return result.rows.map(parseReply);
  }

  async findSubmission(id: string, sender: FeedbackReplySender, submissionKey: string): Promise<{ id: string; fingerprint: string } | undefined> {
    const result = await this.query(
      "SELECT id, fingerprint FROM zook_feedback_replies WHERE feedback_id = $1 AND sender = $2 AND submission_key = $3",
      [id, sender, submissionKey],
    );
    const row = result.rows[0];
    return row ? { id: String(row.id), fingerprint: String(row.fingerprint) } : undefined;
  }

  async listReplyAttachments(replyIds: string[]): Promise<FeedbackAttachmentRecord[]> {
    if (!replyIds.length) return [];
    const result = await this.query(
      `SELECT * FROM zook_feedback_attachments WHERE reply_id = ANY($1::text[]) ORDER BY id`,
      [replyIds],
    );
    return result.rows.map(parseAttachment);
  }

  async append(
    appId: string,
    ownerId: string,
    reply: FeedbackReplyWrite,
    attachments: FeedbackAttachmentRecord[],
    close: boolean,
  ): Promise<FeedbackReplyWriteResult> {
    const result = await this.query(
      `WITH parent AS (
         SELECT id FROM zook_feedback WHERE app_id = $1 AND user_id = $2 AND id = $3 FOR UPDATE
       ), saved AS (
         INSERT INTO zook_feedback_replies (id, feedback_id, sender, message, submission_key, fingerprint, created_at)
         SELECT $4, parent.id, $5, $6, $7, $8, $9::timestamptz FROM parent
         ON CONFLICT (feedback_id, sender, submission_key) DO NOTHING
         RETURNING id, sequence, created_at
       ), files AS (
         INSERT INTO zook_feedback_attachments
           (id, feedback_id, app_id, user_id, file_name, mime_type, size_bytes, width, height, storage_path, created_at, reply_id)
         SELECT file.id, $3, $1, $2, file.name, file.mime, file.bytes, file.width, file.height, file.path, saved.created_at, saved.id
         FROM saved CROSS JOIN jsonb_to_recordset($10::jsonb)
           AS file(id text, name text, mime text, bytes int, width int, height int, path text)
       )
       UPDATE zook_feedback AS feedback
       SET updated_at = GREATEST(feedback.updated_at, saved.created_at),
           conversation_updated_at = GREATEST(feedback.conversation_updated_at, saved.created_at),
           needs_reply = ($5 = 'user'),
           last_support_message = CASE WHEN $5 = 'support' THEN saved.sequence ELSE feedback.last_support_message END,
           status = CASE WHEN $11::boolean THEN 'done' WHEN feedback.status = 'done' THEN 'done' ELSE 'doing' END
       FROM saved WHERE feedback.id = $3 RETURNING saved.id`,
      [appId, ownerId, reply.feedbackId, reply.id, reply.sender, reply.message, reply.submissionKey, reply.fingerprint, reply.createdAt,
        JSON.stringify(attachments.map(file => ({
          id: file.id, name: file.fileName, mime: file.mimeType, bytes: file.sizeBytes, width: file.width, height: file.height, path: file.storagePath,
        }))), close],
    ).catch(error => {
      if (error instanceof pg.DatabaseError && /^((22|23|42)\w{3}|40001|40P01)$/.test(error.code ?? "")) {
        throw new FeedbackReplyWriteRolledBackError(error);
      }
      throw error;
    });
    if (result.rows[0]) return { kind: "saved", id: String(result.rows[0].id) };
    const prior = await this.query(
      `SELECT r.id, r.fingerprint FROM zook_feedback_replies r JOIN zook_feedback f ON f.id = r.feedback_id
       WHERE f.app_id = $1 AND f.user_id = $2 AND f.id = $3 AND r.sender = $4 AND r.submission_key = $5`,
      [appId, ownerId, reply.feedbackId, reply.sender, reply.submissionKey],
    );
    const row = prior.rows[0];
    if (!row) return { kind: "missing" };
    return row.fingerprint === reply.fingerprint ? { kind: "replayed", id: String(row.id) } : { kind: "conflict" };
  }

  async markRead(appId: string, id: string, ownerId: string, messageId: string): Promise<boolean> {
    const result = await this.query(
      `UPDATE zook_feedback AS feedback
       SET read_support_message = GREATEST(feedback.read_support_message, replies.sequence)
       FROM zook_feedback_replies AS replies
       WHERE feedback.app_id = $1 AND feedback.id = $2 AND feedback.user_id = $3
         AND replies.feedback_id = feedback.id AND replies.id = $4 AND replies.sender = 'support'
       RETURNING feedback.id`,
      [appId, id, ownerId, messageId],
    );
    return result.rows.length > 0;
  }
}

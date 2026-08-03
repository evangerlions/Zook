import type { QueryResult, QueryResultRow } from "pg";
import type {
  AiOutputReactionRecord,
  AiOutputReportRecord,
} from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

function parseReport(row: QueryResultRow): AiOutputReportRecord {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    targetType: row.target_type as AiOutputReportRecord["targetType"],
    targetId: String(row.target_id),
    messageId: row.message_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    chapterId: row.chapter_id == null ? undefined : Number(row.chapter_id),
    chapterRevisionId: row.chapter_revision_id ?? undefined,
    scene: row.scene as AiOutputReportRecord["scene"],
    category: row.category as AiOutputReportRecord["category"],
    description: row.description ?? undefined,
    encryptedContentKeyId: String(row.encrypted_content_key_id),
    encryptedContentAlgorithm: String(row.encrypted_content_algorithm),
    encryptedContentNonceBase64: String(row.encrypted_content_nonce_base64),
    encryptedContentCiphertextBase64: String(
      row.encrypted_content_ciphertext_base64,
    ),
    contentHash: String(row.content_hash),
    turnId: row.turn_id ?? undefined,
    providerRequestId: row.provider_request_id ?? undefined,
    modelKey: row.model_key ?? undefined,
    clientRegion: row.client_region ?? undefined,
    accountRegion: String(row.account_region),
    effectiveRegion: row.effective_region ?? undefined,
    platform: row.platform ?? undefined,
    appVersion: row.app_version ?? undefined,
    locale: row.locale ?? undefined,
    status: row.status as AiOutputReportRecord["status"],
    resolutionCode: row.resolution_code ?? undefined,
    resolutionNote: row.resolution_note ?? undefined,
    createdAt: toIsoString(row.created_at) as string,
    updatedAt: toIsoString(row.updated_at) as string,
    resolvedAt: toIsoString(row.resolved_at),
  };
}

function parseReaction(row: QueryResultRow): AiOutputReactionRecord {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    targetType: "chapter_revision",
    targetId: String(row.target_id),
    reaction: "like",
    chapterId: Number(row.chapter_id),
    chapterRevisionId: String(row.chapter_revision_id),
    contentHash: String(row.content_hash),
    turnId: row.turn_id ?? undefined,
    providerRequestId: row.provider_request_id ?? undefined,
    platform: row.platform ?? undefined,
    appVersion: row.app_version ?? undefined,
    effectiveRegion: row.effective_region ?? undefined,
    createdAt: toIsoString(row.created_at) as string,
  };
}

const reportColumns = `
  id, submission_id, app_id, user_id, target_type, target_id,
  message_id, session_id, chapter_id, chapter_revision_id, scene, category,
  description, encrypted_content_key_id, encrypted_content_algorithm,
  encrypted_content_nonce_base64, encrypted_content_ciphertext_base64,
  content_hash, turn_id, provider_request_id, model_key, client_region,
  account_region, effective_region, platform, app_version, locale, status,
  resolution_code, resolution_note, created_at, updated_at, resolved_at
`;

const reactionColumns = `
  id, submission_id, app_id, user_id, target_type, target_id, reaction,
  chapter_id, chapter_revision_id, content_hash, turn_id, provider_request_id,
  platform, app_version, effective_region, created_at
`;

export class PostgresAiOutputReportingStore {
  constructor(private readonly query: PostgresQuery) {}

  async insertReport(record: AiOutputReportRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_ai_output_reports (${reportColumns})
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
         $25, $26, $27, $28, $29, $30, $31::timestamptz,
         $32::timestamptz, $33::timestamptz
       )`,
      [
        record.id,
        record.submissionId,
        record.appId,
        record.userId,
        record.targetType,
        record.targetId,
        record.messageId ?? null,
        record.sessionId ?? null,
        record.chapterId ?? null,
        record.chapterRevisionId ?? null,
        record.scene,
        record.category,
        record.description ?? null,
        record.encryptedContentKeyId,
        record.encryptedContentAlgorithm,
        record.encryptedContentNonceBase64,
        record.encryptedContentCiphertextBase64,
        record.contentHash,
        record.turnId ?? null,
        record.providerRequestId ?? null,
        record.modelKey ?? null,
        record.clientRegion ?? null,
        record.accountRegion,
        record.effectiveRegion ?? null,
        record.platform ?? null,
        record.appVersion ?? null,
        record.locale ?? null,
        record.status,
        record.resolutionCode ?? null,
        record.resolutionNote ?? null,
        record.createdAt,
        record.updatedAt,
        record.resolvedAt ?? null,
      ],
    );
  }

  async findReportBySubmission(
    appId: string,
    userId: string,
    submissionId: string,
  ): Promise<AiOutputReportRecord | undefined> {
    const result = await this.query(
      `SELECT ${reportColumns}
       FROM zook_ai_output_reports
       WHERE app_id = $1 AND user_id = $2 AND submission_id = $3
       LIMIT 1`,
      [appId, userId, submissionId],
    );
    return result.rows[0] ? parseReport(result.rows[0]) : undefined;
  }

  async findReportById(
    appId: string,
    reportId: string,
  ): Promise<AiOutputReportRecord | undefined> {
    const result = await this.query(
      `SELECT ${reportColumns}
       FROM zook_ai_output_reports
       WHERE app_id = $1 AND id = $2
       LIMIT 1`,
      [appId, reportId],
    );
    return result.rows[0] ? parseReport(result.rows[0]) : undefined;
  }

  async listReports(filter: {
    appId: string;
    userId?: string;
    category?: AiOutputReportRecord["category"];
    status?: AiOutputReportRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): Promise<AiOutputReportRecord[]> {
    const clauses = ["app_id = $1"];
    const values: unknown[] = [filter.appId];
    if (filter.userId) {
      values.push(filter.userId);
      clauses.push(`user_id = $${values.length}`);
    }
    if (filter.category) {
      values.push(filter.category);
      clauses.push(`category = $${values.length}`);
    }
    if (filter.status) {
      values.push(filter.status);
      clauses.push(`status = $${values.length}`);
    }
    if (filter.createdAtFromIso) {
      values.push(filter.createdAtFromIso);
      clauses.push(`created_at >= $${values.length}::timestamptz`);
    }
    const limit = Number.isFinite(filter.limit)
      ? Math.max(1, Math.min(Math.floor(filter.limit as number), 500))
      : 100;
    const result = await this.query(
      `SELECT ${reportColumns}
       FROM zook_ai_output_reports
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      values,
    );
    return result.rows.map(parseReport);
  }

  async updateReportStatus(
    appId: string,
    reportId: string,
    status: AiOutputReportRecord["status"],
    resolutionCode?: string,
    resolutionNote?: string,
  ): Promise<AiOutputReportRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_ai_output_reports
       SET status = $3,
           resolution_code = $4,
           resolution_note = $5,
           updated_at = NOW(),
           resolved_at = CASE
             WHEN $3 IN ('resolved', 'rejected') THEN NOW()
             ELSE NULL
           END
       WHERE app_id = $1 AND id = $2
       RETURNING ${reportColumns}`,
      [
        appId,
        reportId,
        status,
        resolutionCode ?? null,
        resolutionNote ?? null,
      ],
    );
    return result.rows[0] ? parseReport(result.rows[0]) : undefined;
  }

  async insertReaction(record: AiOutputReactionRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_ai_output_reactions (${reactionColumns})
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16::timestamptz
       )`,
      [
        record.id,
        record.submissionId,
        record.appId,
        record.userId,
        record.targetType,
        record.targetId,
        record.reaction,
        record.chapterId,
        record.chapterRevisionId,
        record.contentHash,
        record.turnId ?? null,
        record.providerRequestId ?? null,
        record.platform ?? null,
        record.appVersion ?? null,
        record.effectiveRegion ?? null,
        record.createdAt,
      ],
    );
  }

  async findReactionBySubmission(
    appId: string,
    userId: string,
    submissionId: string,
  ): Promise<AiOutputReactionRecord | undefined> {
    const result = await this.query(
      `SELECT ${reactionColumns}
       FROM zook_ai_output_reactions
       WHERE app_id = $1 AND user_id = $2 AND submission_id = $3
       LIMIT 1`,
      [appId, userId, submissionId],
    );
    return result.rows[0] ? parseReaction(result.rows[0]) : undefined;
  }
}

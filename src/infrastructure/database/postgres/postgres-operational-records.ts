import type { QueryResult, QueryResultRow } from "pg";
import type {
  AnalyticsEventRecord,
  ClientLogLineRecord,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  ContentSafetyCheckRecord,
  FailedEventRecord,
  FileRecord,
  NotificationJobRecord,
  SmsVerificationRecord,
} from "../../../shared/types.ts";
import {
  parseAnalyticsEvent,
  parseFailedEvent,
  parseFile,
  parseNotificationJob,
} from "./postgres-row-parsers.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

function parseSmsVerificationRecord(row: QueryResultRow): SmsVerificationRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    scene: row.scene as SmsVerificationRecord["scene"],
    channel: row.channel as SmsVerificationRecord["channel"],
    phoneMasked: String(row.phone_masked),
    phoneHash: String(row.phone_hash),
    phoneNa: row.phone_na ?? undefined,
    codePlaintext: String(row.code_plaintext),
    status: row.status as SmsVerificationRecord["status"],
    isTest: row.is_test === true,
    provider: row.provider as SmsVerificationRecord["provider"],
    providerRequestId: row.provider_request_id ?? undefined,
    providerSerialNo: row.provider_serial_no ?? undefined,
    providerMessage: row.provider_message ?? undefined,
    sentAt: toIsoString(row.sent_at) as string,
    expiresAt: toIsoString(row.expires_at) as string,
    consumedAt: toIsoString(row.consumed_at),
    failedAt: toIsoString(row.failed_at),
    revealCount: Number(row.reveal_count ?? 0),
    lastRevealedAt: toIsoString(row.last_revealed_at),
    createdAt: toIsoString(row.created_at) as string,
    updatedAt: toIsoString(row.updated_at) as string,
  };
}

function parseClientLogUploadTask(row: QueryResultRow): ClientLogUploadTaskRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: row.user_id ?? undefined,
    did: row.did ?? row.client_id ?? undefined,
    keyId: String(row.key_id),
    fromTsMs: row.from_ts_ms === null || row.from_ts_ms === undefined ? undefined : Number(row.from_ts_ms),
    toTsMs: row.to_ts_ms === null || row.to_ts_ms === undefined ? undefined : Number(row.to_ts_ms),
    maxLines: row.max_lines === null || row.max_lines === undefined ? undefined : Number(row.max_lines),
    maxBytes: row.max_bytes === null || row.max_bytes === undefined ? undefined : Number(row.max_bytes),
    status: row.status as ClientLogUploadTaskRecord["status"],
    claimToken: row.claim_token ?? undefined,
    claimExpireAt: toIsoString(row.claim_expire_at),
    createdAt: toIsoString(row.created_at) as string,
    expiresAt: toIsoString(row.expires_at),
    uploadedAt: toIsoString(row.uploaded_at),
    uploadedFileName: row.uploaded_file_name ?? undefined,
    uploadedFilePath: row.uploaded_file_path ?? undefined,
    uploadedFileSizeBytes: row.uploaded_file_size_bytes === null || row.uploaded_file_size_bytes === undefined
      ? undefined
      : Number(row.uploaded_file_size_bytes),
    uploadedLineCount: row.uploaded_line_count === null || row.uploaded_line_count === undefined
      ? undefined
      : Number(row.uploaded_line_count),
    failedAt: toIsoString(row.failed_at),
    failureReason: row.failure_reason ?? undefined,
  };
}

function parseContentSafetyCheckRecord(row: QueryResultRow): ContentSafetyCheckRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: row.user_id ?? undefined,
    requestId: row.request_id ?? undefined,
    taskType: row.task_type ?? undefined,
    source: row.source as ContentSafetyCheckRecord["source"],
    method: row.method as ContentSafetyCheckRecord["method"],
    decision: row.decision as ContentSafetyCheckRecord["decision"],
    category: row.category ?? undefined,
    keywordId: row.keyword_id ?? undefined,
    text: row.blocked_text ?? undefined,
    textLength: Number(row.text_length ?? 0),
    textHash: String(row.text_hash),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? undefined : Number(row.latency_ms),
    modelKey: row.model_key ?? undefined,
    provider: row.provider ?? undefined,
    providerModel: row.provider_model ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    failureDetail: row.failure_detail ?? undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: toIsoString(row.created_at) as string,
  };
}

export class PostgresOperationalRecordsStore {
  constructor(private readonly query: PostgresQuery) {}

  async insertAnalyticsEvents(records: AnalyticsEventRecord[]): Promise<void> {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_analytics_events (
           id, app_id, user_id, platform, session_id, page_key, event_name, duration_ms, occurred_at, received_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [record.id, record.appId, record.userId, record.platform, record.sessionId, record.pageKey, record.eventName, record.durationMs ?? null, record.occurredAt, record.receivedAt, JSON.stringify(record.metadata ?? {})],
      );
    }
  }

  async listAnalyticsEvents(appId: string): Promise<AnalyticsEventRecord[]> {
    const result = await this.query(
      `SELECT id, app_id, user_id, platform, session_id, page_key, event_name, duration_ms, occurred_at, received_at, metadata
       FROM zook_analytics_events
       WHERE app_id = $1
       ORDER BY occurred_at ASC`,
      [appId],
    );
    return result.rows.map(parseAnalyticsEvent);
  }

  async insertFile(record: FileRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_files (id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
      [record.id, record.appId, record.ownerUserId, record.storageKey, record.mimeType, record.sizeBytes, record.status, record.createdAt],
    );
  }

  async findFileByOwnerAndStorageKey(appId: string, ownerUserId: string, storageKey: string): Promise<FileRecord | undefined> {
    const result = await this.query(
      `SELECT id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at
       FROM zook_files
       WHERE app_id = $1 AND owner_user_id = $2 AND storage_key = $3
       LIMIT 1`,
      [appId, ownerUserId, storageKey],
    );
    return result.rows[0] ? parseFile(result.rows[0]) : undefined;
  }

  async findFileByAppAndStorageKey(appId: string, storageKey: string): Promise<FileRecord | undefined> {
    const result = await this.query(
      `SELECT id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at
       FROM zook_files
       WHERE app_id = $1 AND storage_key = $2
       LIMIT 1`,
      [appId, storageKey],
    );
    return result.rows[0] ? parseFile(result.rows[0]) : undefined;
  }

  async confirmFile(fileId: string, mimeType: string, sizeBytes: number): Promise<FileRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_files
       SET status = 'CONFIRMED', mime_type = $2, size_bytes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at`,
      [fileId, mimeType, sizeBytes],
    );
    return result.rows[0] ? parseFile(result.rows[0]) : undefined;
  }

  async listSmsVerificationRecords(appId?: string): Promise<SmsVerificationRecord[]> {
    const result = appId
      ? await this.query(
          `SELECT id, app_id, scene, channel, phone_masked, phone_hash, phone_na, code_plaintext, status, is_test, provider, provider_request_id, provider_serial_no, provider_message, sent_at, expires_at, consumed_at, failed_at, reveal_count, last_revealed_at, created_at, updated_at
           FROM zook_sms_verification_records
           WHERE app_id = $1
           ORDER BY created_at DESC`,
          [appId],
        )
      : await this.query(
          `SELECT id, app_id, scene, channel, phone_masked, phone_hash, phone_na, code_plaintext, status, is_test, provider, provider_request_id, provider_serial_no, provider_message, sent_at, expires_at, consumed_at, failed_at, reveal_count, last_revealed_at, created_at, updated_at
           FROM zook_sms_verification_records
           ORDER BY created_at DESC`,
        );
    return result.rows.map(parseSmsVerificationRecord);
  }

  async findSmsVerificationRecord(recordId: string): Promise<SmsVerificationRecord | undefined> {
    const result = await this.query(
      `SELECT id, app_id, scene, channel, phone_masked, phone_hash, phone_na, code_plaintext, status, is_test, provider, provider_request_id, provider_serial_no, provider_message, sent_at, expires_at, consumed_at, failed_at, reveal_count, last_revealed_at, created_at, updated_at
       FROM zook_sms_verification_records
       WHERE id = $1
       LIMIT 1`,
      [recordId],
    );
    return result.rows[0] ? parseSmsVerificationRecord(result.rows[0]) : undefined;
  }

  async insertSmsVerificationRecord(record: SmsVerificationRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_sms_verification_records (
         id, app_id, scene, channel, phone_masked, phone_hash, phone_na, code_plaintext, status, is_test, provider, provider_request_id, provider_serial_no, provider_message, sent_at, expires_at, consumed_at, failed_at, reveal_count, last_revealed_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $16::timestamptz, $17::timestamptz, $18::timestamptz, $19, $20::timestamptz, $21::timestamptz, $22::timestamptz
       )`,
      [
        record.id, record.appId, record.scene, record.channel, record.phoneMasked, record.phoneHash, record.phoneNa ?? null, record.codePlaintext, record.status, record.isTest, record.provider, record.providerRequestId ?? null, record.providerSerialNo ?? null, record.providerMessage ?? null, record.sentAt, record.expiresAt, record.consumedAt ?? null, record.failedAt ?? null, record.revealCount, record.lastRevealedAt ?? null, record.createdAt, record.updatedAt,
      ],
    );
  }

  async updateSmsVerificationRecord(
    recordId: string,
    patch: Partial<Pick<SmsVerificationRecord, "status" | "providerRequestId" | "providerSerialNo" | "providerMessage" | "consumedAt" | "failedAt" | "revealCount" | "lastRevealedAt" | "updatedAt">>,
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [recordId];
    let index = 2;
    const mapping = {
      status: "status",
      providerRequestId: "provider_request_id",
      providerSerialNo: "provider_serial_no",
      providerMessage: "provider_message",
      consumedAt: "consumed_at",
      failedAt: "failed_at",
      revealCount: "reveal_count",
      lastRevealedAt: "last_revealed_at",
      updatedAt: "updated_at",
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (!(key in patch)) continue;
      const value = patch[key as keyof typeof patch];
      fields.push(column.endsWith("_at") || column === "updated_at" ? `${column} = $${index++}::timestamptz` : `${column} = $${index++}`);
      values.push(value ?? null);
    }
    if (!("updatedAt" in patch)) fields.push("updated_at = NOW()");
    if (fields.length === 0) return;
    await this.query(`UPDATE zook_sms_verification_records SET ${fields.join(", ")} WHERE id = $1`, values);
  }

  async deleteSmsVerificationRecordsCreatedBefore(cutoffIso: string): Promise<number> {
    const result = await this.query(
      "DELETE FROM zook_sms_verification_records WHERE created_at < $1::timestamptz",
      [cutoffIso],
    );
    return result.rowCount ?? 0;
  }

  async insertNotificationJob(record: NotificationJobRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_notification_jobs (id, app_id, recipient_user_id, channel, payload, status, retry_count, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())`,
      [record.id, record.appId, record.recipientUserId, record.channel, JSON.stringify(record.payload ?? {}), record.status, record.retryCount],
    );
  }

  async findNotificationJob(jobId: string): Promise<NotificationJobRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, recipient_user_id, channel, payload, status, retry_count FROM zook_notification_jobs WHERE id = $1 LIMIT 1",
      [jobId],
    );
    return result.rows[0] ? parseNotificationJob(result.rows[0]) : undefined;
  }

  async updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount">>,
  ): Promise<NotificationJobRecord | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [jobId];
    let index = 2;
    if (patch.status !== undefined) {
      fields.push(`status = $${index++}`);
      values.push(patch.status);
    }
    if (patch.retryCount !== undefined) {
      fields.push(`retry_count = $${index++}`);
      values.push(patch.retryCount);
    }
    if (fields.length === 0) {
      return await this.findNotificationJob(jobId);
    }
    fields.push("updated_at = NOW()");
    const result = await this.query(
      `UPDATE zook_notification_jobs
       SET ${fields.join(", ")}
       WHERE id = $1
       RETURNING id, app_id, recipient_user_id, channel, payload, status, retry_count`,
      values,
    );
    return result.rows[0] ? parseNotificationJob(result.rows[0]) : undefined;
  }

  async insertFailedEvent(record: FailedEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_failed_events (
         id, app_id, event_type, payload, error_message, retry_count, next_retry_at, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8::timestamptz)`,
      [record.id, record.appId, record.eventType, JSON.stringify(record.payload ?? {}), record.errorMessage, record.retryCount, record.nextRetryAt, record.createdAt],
    );
  }

  async listFailedEvents(appId?: string): Promise<FailedEventRecord[]> {
    const result = appId
      ? await this.query(
          "SELECT id, app_id, event_type, payload, error_message, retry_count, next_retry_at, created_at FROM zook_failed_events WHERE app_id = $1 ORDER BY created_at ASC",
          [appId],
        )
      : await this.query(
          "SELECT id, app_id, event_type, payload, error_message, retry_count, next_retry_at, created_at FROM zook_failed_events ORDER BY created_at ASC",
        );
    return result.rows.map(parseFailedEvent);
  }

  async deleteFailedEvent(eventId: string): Promise<void> {
    await this.query("DELETE FROM zook_failed_events WHERE id = $1", [eventId]);
  }

  async updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): Promise<void> {
    await this.query(
      `UPDATE zook_failed_events
       SET retry_count = $2, error_message = $3, next_retry_at = $4::timestamptz, updated_at = NOW()
       WHERE id = $1`,
      [eventId, patch.retryCount, patch.errorMessage, patch.nextRetryAt],
    );
  }

  async listClientLogUploadTasks(appId?: string): Promise<ClientLogUploadTaskRecord[]> {
    const result = appId
      ? await this.query(`SELECT id, app_id, user_id, did, client_id, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes, status, claim_token, claim_expire_at, created_at, expires_at, uploaded_at, uploaded_file_name, uploaded_file_path, uploaded_file_size_bytes, uploaded_line_count, failed_at, failure_reason FROM zook_client_log_upload_tasks WHERE app_id = $1 ORDER BY created_at DESC`, [appId])
      : await this.query(`SELECT id, app_id, user_id, did, client_id, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes, status, claim_token, claim_expire_at, created_at, expires_at, uploaded_at, uploaded_file_name, uploaded_file_path, uploaded_file_size_bytes, uploaded_line_count, failed_at, failure_reason FROM zook_client_log_upload_tasks ORDER BY created_at DESC`);
    return result.rows.map(parseClientLogUploadTask);
  }

  async findClientLogUploadTask(taskId: string): Promise<ClientLogUploadTaskRecord | undefined> {
    const result = await this.query(`SELECT id, app_id, user_id, did, client_id, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes, status, claim_token, claim_expire_at, created_at, expires_at, uploaded_at, uploaded_file_name, uploaded_file_path, uploaded_file_size_bytes, uploaded_line_count, failed_at, failure_reason FROM zook_client_log_upload_tasks WHERE id = $1 LIMIT 1`, [taskId]);
    return result.rows[0] ? parseClientLogUploadTask(result.rows[0]) : undefined;
  }

  async insertClientLogUploadTask(record: ClientLogUploadTaskRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_client_log_upload_tasks (
         id, app_id, user_id, did, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes,
         status, claim_token, claim_expire_at, created_at, expires_at, uploaded_at,
         uploaded_file_name, uploaded_file_path, uploaded_file_size_bytes, uploaded_line_count, failed_at, failure_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15::timestamptz, $16, $17, $18, $19, $20::timestamptz, $21)`,
      [
        record.id, record.appId, record.userId ?? null, record.did ?? null, record.keyId,
        record.fromTsMs ?? null, record.toTsMs ?? null, record.maxLines ?? null,
        record.maxBytes ?? null, record.status, record.claimToken ?? null,
        record.claimExpireAt ?? null, record.createdAt, record.expiresAt ?? null,
        record.uploadedAt ?? null, record.uploadedFileName ?? null,
        record.uploadedFilePath ?? null, record.uploadedFileSizeBytes ?? null,
        record.uploadedLineCount ?? null, record.failedAt ?? null, record.failureReason ?? null,
      ],
    );
  }

  async updateClientLogUploadTask(
    taskId: string,
    patch: Partial<Pick<ClientLogUploadTaskRecord, "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt" | "uploadedFileName" | "uploadedFilePath" | "uploadedFileSizeBytes" | "uploadedLineCount" | "failedAt" | "failureReason">>,
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [taskId];
    let index = 2;
    const add = (field: string, value: unknown, timestamptz = false) => {
      fields.push(`${field} = $${index++}${timestamptz ? "::timestamptz" : ""}`);
      values.push(value ?? null);
    };
    if ("status" in patch) add("status", patch.status);
    if ("did" in patch) add("did", patch.did);
    if ("claimToken" in patch) add("claim_token", patch.claimToken);
    if ("claimExpireAt" in patch) add("claim_expire_at", patch.claimExpireAt, true);
    if ("uploadedAt" in patch) add("uploaded_at", patch.uploadedAt, true);
    if ("uploadedFileName" in patch) add("uploaded_file_name", patch.uploadedFileName);
    if ("uploadedFilePath" in patch) add("uploaded_file_path", patch.uploadedFilePath);
    if ("uploadedFileSizeBytes" in patch) add("uploaded_file_size_bytes", patch.uploadedFileSizeBytes);
    if ("uploadedLineCount" in patch) add("uploaded_line_count", patch.uploadedLineCount);
    if ("failedAt" in patch) add("failed_at", patch.failedAt, true);
    if ("failureReason" in patch) add("failure_reason", patch.failureReason);
    if (fields.length === 0) return;
    fields.push("updated_at = NOW()");
    await this.query(`UPDATE zook_client_log_upload_tasks SET ${fields.join(", ")} WHERE id = $1`, values);
  }

  async insertClientLogUpload(record: ClientLogUploadRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_client_log_uploads (
         id, task_id, app_id, user_id, key_id, encryption, content_encoding, nonce_base64,
         line_count_reported, plain_bytes_reported, compressed_bytes_reported, encrypted_bytes,
         accepted_count, rejected_count, uploaded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz)`,
      [record.id, record.taskId, record.appId, record.userId, record.keyId, record.encryption, record.contentEncoding, record.nonceBase64, record.lineCountReported ?? null, record.plainBytesReported ?? null, record.compressedBytesReported ?? null, record.encryptedBytes, record.acceptedCount, record.rejectedCount, record.uploadedAt],
    );
  }

  async insertClientLogLines(records: ClientLogLineRecord[]): Promise<void> {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_client_log_lines (
           id, upload_id, task_id, app_id, user_id, timestamp_ms, level, message, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)`,
        [record.id, record.uploadId, record.taskId, record.appId, record.userId, record.timestampMs ?? null, record.level ?? null, record.message ?? null, JSON.stringify(record.payload ?? {}), record.createdAt],
      );
    }
  }

  async insertContentSafetyCheckRecord(record: ContentSafetyCheckRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_content_safety_checks (
         id, app_id, user_id, request_id, task_type, source, method, decision,
         category, keyword_id, blocked_text, text_length, text_hash, latency_ms,
         model_key, provider, provider_model, failure_reason, failure_detail, metadata, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20::jsonb, $21::timestamptz
       )`,
      [record.id, record.appId, record.userId ?? null, record.requestId ?? null, record.taskType ?? null, record.source, record.method, record.decision, record.category ?? null, record.keywordId ?? null, record.text ?? null, record.textLength, record.textHash, record.latencyMs ?? null, record.modelKey ?? null, record.provider ?? null, record.providerModel ?? null, record.failureReason ?? null, record.failureDetail ?? null, JSON.stringify(record.metadata ?? {}), record.createdAt],
    );
  }

  async listContentSafetyCheckRecords(filter: {
    createdAtFromIso?: string;
    createdAtToIso?: string;
    appId?: string;
    source?: ContentSafetyCheckRecord["source"];
    method?: ContentSafetyCheckRecord["method"];
    taskType?: string;
    decision?: ContentSafetyCheckRecord["decision"];
    limit?: number;
  } = {}): Promise<ContentSafetyCheckRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace("?", `$${values.length}`));
    };
    if (filter.createdAtFromIso) add("created_at >= ?::timestamptz", filter.createdAtFromIso);
    if (filter.createdAtToIso) add("created_at < ?::timestamptz", filter.createdAtToIso);
    if (filter.appId) add("app_id = ?", filter.appId);
    if (filter.source) add("source = ?", filter.source);
    if (filter.method) add("method = ?", filter.method);
    if (filter.taskType) add("task_type = ?", filter.taskType);
    if (filter.decision) add("decision = ?", filter.decision);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = typeof filter.limit === "number" && filter.limit > 0
      ? `LIMIT ${Math.min(Math.floor(filter.limit), 5000)}`
      : "";
    const result = await this.query(
      `SELECT id, app_id, user_id, request_id, task_type, source, method, decision, category, keyword_id, blocked_text, text_length, text_hash, latency_ms, model_key, provider, provider_model, failure_reason, failure_detail, metadata, created_at
       FROM zook_content_safety_checks
       ${where}
       ORDER BY created_at DESC
       ${limit}`,
      values,
    );
    return result.rows.map(parseContentSafetyCheckRecord);
  }

  async deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso: string): Promise<number> {
    const result = await this.query(
      "DELETE FROM zook_content_safety_checks WHERE created_at < $1::timestamptz",
      [cutoffIso],
    );
    return result.rowCount ?? 0;
  }
}

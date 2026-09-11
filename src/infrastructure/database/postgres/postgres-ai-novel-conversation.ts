import type { QueryResult, QueryResultRow } from "pg";

import type { AiNovelConversationRecord } from "../../../shared/types.ts";
import type { AiNovelConversationStore } from "../ai-novel-conversation-store.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

const MAX_PAGE_SIZE = 101;

export class PostgresAiNovelConversationStore implements AiNovelConversationStore {
  constructor(private readonly query: PostgresQuery) {}

  async insert(record: AiNovelConversationRecord): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO zook_ai_novel_conversation_records (
         id, app_id, user_id, did, request_id, scene_key,
         message_id, session_id, turn_id, user_text, assistant_text, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12::timestamptz
       )
       ON CONFLICT (app_id, user_id, request_id) DO NOTHING
       RETURNING id`,
      [
        record.id,
        record.appId,
        record.userId,
        record.did ?? null,
        record.requestId,
        record.sceneKey,
        record.messageId ?? null,
        record.sessionId ?? null,
        record.turnId ?? null,
        record.userText,
        record.assistantText,
        record.createdAt,
      ],
    );
    return result.rowCount === 1;
  }

  async list(filter: {
    appId: "ai_novel";
    userId?: string;
    did?: string;
    offset?: number;
    limit?: number;
  }): Promise<AiNovelConversationRecord[]> {
    const clauses = ["app_id = $1"];
    const values: unknown[] = [filter.appId];
    if (filter.userId) {
      values.push(filter.userId);
      clauses.push(`user_id = $${values.length}`);
    }
    if (filter.did) {
      values.push(filter.did);
      clauses.push(`did = $${values.length}`);
    }
    const limit = normalizeLimit(filter.limit);
    const offset = normalizeOffset(filter.offset);
    values.push(limit, offset);
    const result = await this.query(
      `SELECT id, app_id, user_id, did, request_id,
              message_id, session_id, turn_id, scene_key,
              user_text, assistant_text, created_at
       FROM zook_ai_novel_conversation_records
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(parseRecord);
  }

  async trim(input: {
    appId: "ai_novel";
    userId: string;
    highWaterMark: number;
    retainCount: number;
  }): Promise<number> {
    const result = await this.query(
      `WITH ranked AS (
         SELECT
           id,
           ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS position,
           COUNT(*) OVER () AS total
         FROM zook_ai_novel_conversation_records
         WHERE app_id = $1 AND user_id = $2
       )
       DELETE FROM zook_ai_novel_conversation_records AS records
       USING ranked
       WHERE records.id = ranked.id
         AND ranked.total > $3
         AND ranked.position > $4`,
      [input.appId, input.userId, input.highWaterMark, input.retainCount],
    );
    return result.rowCount ?? 0;
  }
}

function parseRecord(row: QueryResultRow): AiNovelConversationRecord {
  return {
    id: String(row.id),
    appId: "ai_novel",
    userId: String(row.user_id),
    did: row.did ? String(row.did) : undefined,
    requestId: String(row.request_id),
    ...optionalRowText(row.message_id, "messageId"),
    ...optionalRowText(row.session_id, "sessionId"),
    ...optionalRowText(row.turn_id, "turnId"),
    sceneKey: String(row.scene_key),
    userText: String(row.user_text),
    assistantText: String(row.assistant_text),
    createdAt: toIsoString(row.created_at) as string,
  };
}

function optionalRowText(
  value: unknown,
  key: "messageId" | "sessionId" | "turnId",
): Record<string, string> {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? { [key]: normalized } : {};
}

function normalizeLimit(value?: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(Math.floor(value as number), MAX_PAGE_SIZE));
}

function normalizeOffset(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value as number));
}

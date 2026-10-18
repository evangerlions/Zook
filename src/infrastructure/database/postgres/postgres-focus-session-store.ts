import type { QueryResultRow } from "pg";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { focusSessionClientId, type FrogSleepFocusSessionWriteResult } from "../../../shared/frogsleep-focus-session.ts";
import { parseEntity } from "./postgres-frogsleep.ts";

type Query = (sql: string, values: unknown[]) => Promise<{ rows: QueryResultRow[] }>;
const predicate = `deleted_at IS NULL AND owner_user_id IS NOT NULL
  AND jsonb_typeof(payload->'client_session_id') = 'string'
  AND length(payload->>'client_session_id') BETWEEN 1 AND 128
  AND btrim(payload->>'client_session_id') <> ''`;
const changed = `EXCLUDED.payload->>'_report_fingerprint' IS NULL OR existing.payload->>'_report_fingerprint' IS DISTINCT FROM EXCLUDED.payload->>'_report_fingerprint'`;
const assignments = ["status", "starts_at", "ends_at", "payload", "updated_at"]
  .map(field => `${field} = CASE WHEN ${changed} THEN EXCLUDED.${field} ELSE existing.${field} END`).join(", ");

/** Database-atomic insert/update keyed by authenticated app, owner and opaque client ID. */
export class PostgresFocusSessionStore {
  constructor(private readonly query: Query) {}

  async upsert(record: FrogSleepEntityRecord): Promise<FrogSleepFocusSessionWriteResult> {
    if (!focusSessionClientId(record)) throw new Error("Atomic focus writes require an owner and valid client session ID.");
    const result = await this.query(`INSERT INTO zook_frogsleep_focus_sessions AS existing
      (id, app_id, owner_user_id, status, starts_at, ends_at, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8::timestamptz, $9::timestamptz)
      ON CONFLICT (app_id, owner_user_id, (payload->>'client_session_id')) WHERE ${predicate}
      DO UPDATE SET ${assignments} RETURNING *`,
      [record.id, record.appId, record.ownerUserId, record.status, record.startsAt, record.endsAt,
        JSON.stringify(record.payload), record.createdAt, record.updatedAt]);
    const stored = parseEntity("focus_session", result.rows[0]);
    // Each report attempt has a fresh server ID; conflict updates preserve the stored ID.
    return { record: stored, inserted: stored.id === record.id };
  }
}

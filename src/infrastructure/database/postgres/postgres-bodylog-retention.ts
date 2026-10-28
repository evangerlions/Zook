import type { BodyLogRetentionStore, RetentionDocument, RetentionKind, GrantSummary } from "../../bodylog-retention-store.ts";
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresBodyLogRetentionStore implements BodyLogRetentionStore {
  constructor(private readonly query: Query) {}
  async list(kind: RetentionKind, userId: string): Promise<RetentionDocument[]> {
    const result = await this.query("SELECT id, kind, user_id, data FROM zook_bodylog_retention_documents WHERE kind=$1 AND user_id=$2", [kind, userId]);
    return result.rows.map(row => ({ id: String(row.id), kind: row.kind as RetentionKind, userId: String(row.user_id), data: row.data as Record<string, unknown> }));
  }
  async grantSummary(now: string): Promise<GrantSummary[]> {
    const result = await this.query(`SELECT data->>'source' AS source, data->>'type' AS type,
      CASE WHEN data->>'type' <> 'premium' THEN 'issued'
        WHEN (data->>'endsAt')::timestamptz <= $1::timestamptz THEN 'expired'
        WHEN (data->>'startsAt')::timestamptz > $1::timestamptz THEN 'queued' ELSE 'active' END AS state,
      COUNT(*)::int AS count FROM zook_bodylog_retention_documents WHERE kind='grant'
      GROUP BY source,type,state ORDER BY source,type,state`, [now]);
    return result.rows.map(row=>({source:String(row.source),type:String(row.type),state:row.state as GrantSummary["state"],count:Number(row.count)}));
  }
  async save(document: RetentionDocument) {
    await this.query(`INSERT INTO zook_bodylog_retention_documents(id,kind,user_id,data) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data WHERE zook_bodylog_retention_documents.user_id=EXCLUDED.user_id AND zook_bodylog_retention_documents.kind=EXCLUDED.kind`,
      [document.id, document.kind, document.userId, JSON.stringify(document.data)]);
  }
}

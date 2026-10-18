import type { PoolClient, QueryResultRow } from "pg";
import type { PersonalResourceKind, PersonalSyncRepository, PersonalSyncState, PersonalSyncTransaction, PersonalVersion } from "../../../modules/frogsleep/personal-sync/personal-sync.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

/** Serializes private revisions per account and keeps events and idempotency receipts atomic. */
export class PostgresPersonalSyncRepository implements PersonalSyncRepository {
  constructor(private readonly connect: () => Promise<PoolClient>) {}
  async run<T>(userId: string, operation: (tx: PersonalSyncTransaction) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      const membership = await client.query("SELECT id,status FROM zook_app_users WHERE app_id='frogsleep' AND user_id=$1 FOR SHARE", [userId]);
      if (membership.rows[0]?.status !== "ACTIVE") throw new ApplicationError(403, "APP_MEMBERSHIP_REQUIRED", "An active Sleep account is required.");
      await client.query("INSERT INTO zook_frogsleep_personal_sync_state(app_id,user_id) VALUES('frogsleep',$1) ON CONFLICT DO NOTHING", [userId]);
      const row = (await client.query("SELECT * FROM zook_frogsleep_personal_sync_state WHERE app_id='frogsleep' AND user_id=$1 FOR UPDATE", [userId])).rows[0];
      if (row.deleted) { await client.query("UPDATE zook_frogsleep_personal_sync_state SET deleted=FALSE WHERE app_id='frogsleep' AND user_id=$1", [userId]); row.deleted=false; }
      const result = await operation(new PostgresPersonalSyncTransaction(client, userId, row));
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
/** One request-local transaction adapter; never stored on a singleton service. */
class PostgresPersonalSyncTransaction implements PersonalSyncTransaction {
  readonly state: PersonalSyncState;
  constructor(private readonly client: PoolClient, private readonly userId: string, row: QueryResultRow) {
    this.state = { epoch: String(row.epoch), cursorSecret: String(row.cursor_secret), sequence: Number(row.sequence), legacyAllowed: row.legacy_allowed, deleted: row.deleted };
  }
  async current(kind: PersonalResourceKind, id: string) {
    const result = await this.client.query("SELECT document FROM zook_frogsleep_personal_versions WHERE app_id='frogsleep' AND user_id=$1 AND kind=$2 AND resource_id=$3 ORDER BY sequence DESC LIMIT 1", [this.userId, kind, id]);
    return result.rows[0]?.document as PersonalVersion | undefined;
  }
  async receipt(key: string) {
    const result = await this.client.query("SELECT digest,result FROM zook_frogsleep_personal_receipts WHERE app_id='frogsleep' AND user_id=$1 AND request_key=$2", [this.userId, key]);
    return result.rows[0] as { digest: string; result: PersonalVersion } | undefined;
  }
  async saveReceipt(key: string, digest: string, result: PersonalVersion) {
    await this.client.query("INSERT INTO zook_frogsleep_personal_receipts(app_id,user_id,request_key,digest,result) VALUES('frogsleep',$1,$2,$3,$4::jsonb)", [this.userId, key, digest, JSON.stringify(result)]);
  }
  async commit(version: PersonalVersion, key: string, digest: string) {
    await this.client.query("INSERT INTO zook_frogsleep_personal_versions(app_id,user_id,kind,resource_id,sequence,document) VALUES('frogsleep',$1,$2,$3,$4,$5::jsonb)", [this.userId, version.kind, version.id, version.sequence, JSON.stringify(version)]);
    await this.client.query("INSERT INTO zook_frogsleep_personal_receipts(app_id,user_id,request_key,digest,result) VALUES('frogsleep',$1,$2,$3,$4::jsonb)", [this.userId, key, digest, JSON.stringify(version)]);
    await this.client.query("UPDATE zook_frogsleep_personal_sync_state SET sequence=$2 WHERE app_id='frogsleep' AND user_id=$1", [this.userId, version.sequence]);
    this.state.sequence = version.sequence;
  }
  async browse(boundary: number, limit: number, after?: { time: string; id: string }) {
    const result = await this.client.query(`SELECT document FROM (
      SELECT DISTINCT ON(resource_id) resource_id,document FROM zook_frogsleep_personal_versions
      WHERE app_id='frogsleep' AND user_id=$1 AND kind='sleep_report' AND sequence<=$2 ORDER BY resource_id,sequence DESC
    ) v WHERE NOT (document->>'deleted')::boolean AND ($3::text IS NULL OR (COALESCE(document#>>'{data,recorded_at}','') COLLATE "C",resource_id COLLATE "C")<($3 COLLATE "C",$4::text COLLATE "C"))
    ORDER BY COALESCE(document#>>'{data,recorded_at}','') COLLATE "C" DESC,resource_id COLLATE "C" DESC LIMIT $5`, [this.userId,boundary,after?.time ?? null,after?.id ?? null,limit]);
    return result.rows.map(r=>r.document as PersonalVersion);
  }
  async page(mode: "restore" | "changes", boundary: number, after: number, limit: number, kind?: PersonalResourceKind) {
    const source = mode === "restore"
      ? "SELECT DISTINCT ON(kind,resource_id) sequence,document FROM zook_frogsleep_personal_versions WHERE app_id='frogsleep' AND user_id=$1 AND sequence<=$2 ORDER BY kind,resource_id,sequence DESC"
      : "SELECT sequence,document FROM zook_frogsleep_personal_versions WHERE app_id='frogsleep' AND user_id=$1 AND sequence<=$2";
    const result = await this.client.query(`SELECT document FROM (${source}) v WHERE sequence>$3 AND ($5::text IS NULL OR document->>'kind'=$5) ORDER BY sequence LIMIT $4`, [this.userId, boundary, after, limit, kind ?? null]);
    return result.rows.map(r => r.document as PersonalVersion);
  }
}

import type { LocalClaim } from "../../../modules/lighttick/manual/local-adoption.types.ts";
type Query = (
  sql: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, any>[]; rowCount?: number | null }>;
export class PostgresLocalAdoptionStore {
  constructor(private readonly query: Query) {}
  async lockLocalSource(hash: string) {
    await this.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `local-adoption:${hash}`,
    ]);
  }
  async getLocalClaim(hash: string): Promise<LocalClaim | undefined> {
    const { rows } = await this.query(
      "SELECT * FROM zook_lighttick_local_claims WHERE source_hash=$1",
      [hash],
    );
    const r = rows[0];
    return r
      ? {
          sourceHash: r.source_hash,
          userId: r.user_id,
          entityType: r.entity_type,
          cloudId: r.cloud_id,
          payloadHash: r.payload_hash,
          sourcePayload: r.source_payload,
          deleted: r.deleted,
        }
      : undefined;
  }
  async saveLocalClaim(r: LocalClaim) {
    await this.query(
      `INSERT INTO zook_lighttick_local_claims (source_hash,app_id,user_id,entity_type,cloud_id,payload_hash,source_payload,deleted)
 VALUES ($1,'lighttick',$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        r.sourceHash,
        r.userId,
        r.entityType,
        r.cloudId,
        r.payloadHash,
        JSON.stringify(r.sourcePayload),
        r.deleted,
      ],
    );
  }
}

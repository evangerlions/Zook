import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { BucketRepository, BucketSnapshot, BucketVersion } from "../../../modules/lighttick/investments/buckets/bucket.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";

type Query = (sql: string, args: unknown[]) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresInvestmentBucketStore implements BucketRepository {
  constructor(readonly query: Query) {}

  async get(o: LightTickOwner, account: string, revision?: number): Promise<BucketSnapshot | undefined> {
    const args = [o.appId, o.userId, account];
    const where = revision === undefined ? "" : " AND revision = $4";
    const result = await this.query(
      "SELECT payload FROM zook_lighttick_investment_bucket_versions WHERE app_id=$1 AND user_id=$2 AND account_id=$3"
      + where + " ORDER BY revision DESC LIMIT 1",
      revision === undefined ? args : [...args, revision],
    );
    return result.rows[0]?.payload;
  }

  async versions(o: LightTickOwner, account: string): Promise<BucketVersion[]> {
    const result = await this.query(
      `SELECT revision, payload->>'effective_at' AS effective_at,
        (payload->>'base_account_revision')::int AS base_account_revision
        FROM zook_lighttick_investment_bucket_versions
        WHERE app_id=$1 AND user_id=$2 AND account_id=$3 ORDER BY revision DESC`,
      [o.appId, o.userId, account],
    );
    return result.rows as BucketVersion[];
  }

  async append(o: LightTickOwner, snapshot: BucketSnapshot) {
    const result = await this.query(
      `INSERT INTO zook_lighttick_investment_bucket_versions (app_id, user_id, account_id, revision, payload)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING revision`,
      [o.appId, o.userId, snapshot.account_id, snapshot.revision, JSON.stringify(snapshot)],
    );
    if (!result.rows.length) fail(409, "Allocation revision changed.");
  }

  async export(o: LightTickOwner) {
    const args = [o.appId, o.userId];
    const { rows } = await this.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(octet_length(payload::text)), 0)::text AS bytes
       FROM zook_lighttick_investment_bucket_versions WHERE app_id=$1 AND user_id=$2`, args,
    );
    if (rows[0].count > 5000 || Number(rows[0].bytes) > 8 * 1024 * 1024) fail(413, "Bucket export exceeds capacity.");
    const result = await this.query(
      `SELECT payload FROM zook_lighttick_investment_bucket_versions
        WHERE app_id=$1 AND user_id=$2 ORDER BY account_id,revision`, args,
    );
    return result.rows.map(row => row.payload as BucketSnapshot);
  }
}

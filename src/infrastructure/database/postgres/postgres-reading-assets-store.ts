import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ReadingAsset,
  ReadingAssetsRepository,
} from "../../../modules/lighttick/independent-reading/reading-assets.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresReadingAssetsStore implements ReadingAssetsRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, workId: string, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_work_assets WHERE app_id=$1 AND user_id=$2 AND work_id=$3 AND id=$4",
        [o.appId, o.userId, workId, id],
      )
    ).rows[0]?.payload as ReadingAsset | undefined;
  }
  async list(o: LightTickOwner, workId: string) {
    return (
      await this.query(
        "SELECT payload-'value' AS payload FROM zook_lighttick_reading_work_assets WHERE app_id=$1 AND user_id=$2 AND work_id=$3 ORDER BY id COLLATE \"C\"",
        [o.appId, o.userId, workId],
      )
    ).rows.map((r) => r.payload as Omit<ReadingAsset, "value">);
  }
  async save(o: LightTickOwner, row: ReadingAsset) {
    const result = await this.query(
      "INSERT INTO zook_lighttick_reading_work_assets(app_id,user_id,work_id,id,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(app_id,user_id,work_id,id) DO UPDATE SET payload=zook_lighttick_reading_work_assets.payload WHERE zook_lighttick_reading_work_assets.payload=EXCLUDED.payload RETURNING id",
      [o.appId, o.userId, row.work_id, row.id, JSON.stringify(row)],
    );
    if (!result.rows.length) fail(409, "Immutable reading asset conflict");
  }
}

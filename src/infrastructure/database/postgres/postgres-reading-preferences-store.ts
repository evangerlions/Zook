import type {
  ReadingPreferences,
  ReadingPreferencesRepository,
} from "../../../modules/lighttick/reading/reading-preferences.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresReadingPreferencesStore
  implements ReadingPreferencesRepository
{
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_preferences WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0]?.payload as ReadingPreferences | undefined;
  }
  async history(o: LightTickOwner, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_preferences_versions WHERE app_id=$1 AND user_id=$2 AND revision::bigint<$3::bigint ORDER BY revision DESC LIMIT $4",
        [o.appId, o.userId, before, limit],
      )
    ).rows.map((r) => r.payload as ReadingPreferences);
  }
  async save(o: LightTickOwner, row: ReadingPreferences, base: number) {
    const args = [o.appId, o.userId, row.revision, JSON.stringify(row)],
      saved =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_reading_preferences(app_id,user_id,revision,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING revision",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_reading_preferences SET revision=$3,payload=$4::jsonb WHERE app_id=$1 AND user_id=$2 AND revision=$5 RETURNING revision",
              [...args, base],
            );
    if (!saved.rows.length) fail(409, "阅读偏好已变化，请保留本机输入核对。");
    await this.query(
      "INSERT INTO zook_lighttick_reading_preferences_versions(app_id,user_id,revision,payload) VALUES($1,$2,$3,$4::jsonb)",
      args,
    );
  }
}

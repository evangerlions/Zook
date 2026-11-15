import type {
  TodayFocusRepository,
  TodayFocusRow,
} from "../../../modules/lighttick/today-focus/today-focus.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresTodayFocusStore implements TodayFocusRepository {
  constructor(private readonly query: Query) {}
  async get(o: LightTickOwner, date: string) {
    const r = await this.query(
      "SELECT data FROM zook_lighttick_today_focus WHERE app_id=$1 AND user_id=$2 AND business_date=$3",
      [o.appId, o.userId, date],
    );
    return r.rows[0]?.data as TodayFocusRow | undefined;
  }
  async save(row: TodayFocusRow, base: number) {
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_today_focus(app_id,user_id,business_date,revision,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING revision",
            [
              row.appId,
              row.userId,
              row.business_date,
              row.revision,
              JSON.stringify(row),
            ],
          )
        : await this.query(
            "UPDATE zook_lighttick_today_focus SET revision=$4,data=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND business_date=$3 AND revision=$6 RETURNING revision",
            [
              row.appId,
              row.userId,
              row.business_date,
              row.revision,
              JSON.stringify(row),
              base,
            ],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "今日焦点已变化。",
      );
  }
}

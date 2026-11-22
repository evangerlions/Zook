import type {
  WeeklyStore,
  WeeklyCard,
} from "../../../modules/lighttick/weekly-cards/weekly-card.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { QueryResult } from "./postgres-lighttick-owner-transaction.ts";
import { ApplicationError } from "../../../shared/errors.ts";
export class PostgresWeeklyCardStore implements WeeklyStore {
  constructor(
    private readonly query: (
      sql: string,
      args?: unknown[],
    ) => Promise<QueryResult>,
  ) {}
  async get(o: LightTickOwner, w: string) {
    return (
      await this.query(
        "SELECT data FROM zook_lighttick_weekly_cards WHERE app_id=$1 AND user_id=$2 AND week_start=$3",
        [o.appId, o.userId, w],
      )
    ).rows[0]?.data as WeeklyCard | undefined;
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT week_start::text,revision,data->>'confirmed_at' AS confirmed_at FROM zook_lighttick_weekly_cards WHERE app_id=$1 AND user_id=$2 ORDER BY week_start DESC LIMIT 52",
        [o.appId, o.userId],
      )
    ).rows as { week_start: string; revision: number; confirmed_at: string }[];
  }
  async save(o: LightTickOwner, c: WeeklyCard, base: number) {
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_weekly_cards VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING revision",
            [o.appId, o.userId, c.week_start, c.revision, c],
          )
        : await this.query(
            "UPDATE zook_lighttick_weekly_cards SET revision=$4,data=$5 WHERE app_id=$1 AND user_id=$2 AND week_start=$3 AND revision=$6 RETURNING revision",
            [o.appId, o.userId, c.week_start, c.revision, c, base],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "周卡已变化，请保留输入并重新核对。",
      );
  }
}

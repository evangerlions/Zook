import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  FocusRepository,
  FocusRow,
  FocusPreferences,
} from "../../../modules/lighttick/focus/focus.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;
const conflict = () =>
  new ApplicationError(
    409,
    "LIGHTTICK_VERSION_CONFLICT",
    "计时已变化，请刷新。",
  );
export class PostgresFocusStore implements FocusRepository {
  constructor(private readonly query: Query) {}
  async preferences(o: LightTickOwner) {
    const r = await this.query(
      "SELECT data FROM zook_lighttick_focus_preferences WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );
    return r.rows[0]?.data as FocusPreferences | undefined;
  }
  async savePreferences(
    o: LightTickOwner,
    row: FocusPreferences,
    base: number,
  ) {
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_focus_preferences(app_id,user_id,revision,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING revision",
            [o.appId, o.userId, row.revision, JSON.stringify(row)],
          )
        : await this.query(
            "UPDATE zook_lighttick_focus_preferences SET revision=$3,data=$4::jsonb WHERE app_id=$1 AND user_id=$2 AND revision=$5 RETURNING revision",
            [o.appId, o.userId, row.revision, JSON.stringify(row), base],
          );
    if (!r.rows.length) throw conflict();
  }
  async active(o: LightTickOwner) {
    const r = await this.query(
      "SELECT data FROM zook_lighttick_focus_sessions WHERE app_id=$1 AND user_id=$2 AND status IN ('running','paused')",
      [o.appId, o.userId],
    );
    return r.rows[0]?.data as FocusRow | undefined;
  }
  async get(o: LightTickOwner, id: string) {
    const r = await this.query(
      "SELECT data FROM zook_lighttick_focus_sessions WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
    return r.rows[0]?.data as FocusRow | undefined;
  }
  async save(row: FocusRow, base: number) {
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_focus_sessions(app_id,user_id,id,revision,status,kind,business_date,started_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            [
              row.appId,
              row.userId,
              row.id,
              row.revision,
              row.status,
              row.kind,
              row.business_date,
              row.started_at,
              JSON.stringify(row),
            ],
          )
        : await this.query(
            "UPDATE zook_lighttick_focus_sessions SET revision=$4,status=$5,data=$6::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$7 RETURNING id",
            [
              row.appId,
              row.userId,
              row.id,
              row.revision,
              row.status,
              JSON.stringify(row),
              base,
            ],
          );
    if (!r.rows.length) throw conflict();
  }
  async history(
    o: LightTickOwner,
    offset: number,
    limit: number,
    kind = "all",
  ) {
    const args = [o.appId, o.userId, kind];
    const predicate =
      "app_id=$1 AND user_id=$2 AND status IN ('saved','discarded') AND ($3='all' OR kind=$3)";
    const r = await this.query(
        `SELECT data FROM zook_lighttick_focus_sessions WHERE ${predicate} ORDER BY started_at DESC,id ASC OFFSET $4 LIMIT $5`,
        [...args, offset, limit],
      ),
      count = await this.query(
        `SELECT count(*)::int AS total FROM zook_lighttick_focus_sessions WHERE ${predicate}`,
        args,
      );
    return {
      items: r.rows.map((r) => r.data as FocusRow),
      total: Number(count.rows[0].total),
    };
  }
  async summary(o: LightTickOwner, start: string, end: string) {
    const r = await this.query(
      `SELECT count(*)::int AS sessions,COALESCE(sum((data->>'actual_seconds')::int),0)::float8 AS seconds,count(DISTINCT business_date)::int AS days,COALESCE(array_agg(DISTINCT business_date::text),'{}'::text[]) AS dates FROM zook_lighttick_focus_sessions WHERE app_id=$1 AND user_id=$2 AND business_date>=$3 AND business_date<=$4 AND kind='focus' AND status='saved' AND (data->>'actual_seconds')::int>0`,
      [o.appId, o.userId, start, end],
    );
    return {
      sessions: Number(r.rows[0].sessions),
      seconds: Number(r.rows[0].seconds),
      days: Number(r.rows[0].days),
      dates: r.rows[0].dates as string[],
    };
  }
}

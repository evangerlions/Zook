import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { appendDomainChange } from "./postgres-domain-changes-store.ts";
import type {
  ReadingScheduleDay,
  ReadingScheduleRepository,
} from "../../../modules/lighttick/reading/reading-schedule.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresReadingScheduleStore implements ReadingScheduleRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, date: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_schedule_days WHERE app_id=$1 AND user_id=$2 AND date=$3",
        [o.appId, o.userId, date],
      )
    ).rows[0]?.payload as ReadingScheduleDay | undefined;
  }
  async history(o: LightTickOwner, before: string, limit: number) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_reading_schedule_days WHERE app_id=$1 AND user_id=$2 AND date COLLATE "C"<$3 ORDER BY date COLLATE "C" DESC LIMIT $4',
        [o.appId, o.userId, before, limit],
      )
    ).rows.map((r) => r.payload as ReadingScheduleDay);
  }
  async due(date: string, minute: number, now: string, limit: number) {
    return (
      await this.query(
        `SELECT p.app_id AS "appId",p.user_id AS "userId" FROM zook_lighttick_reading_preferences p LEFT JOIN zook_lighttick_reading_schedule_days d ON d.app_id=p.app_id AND d.user_id=p.user_id AND d.date=$1 LEFT JOIN zook_lighttick_reading_work w ON w.app_id=p.app_id AND w.user_id=p.user_id AND w.id=d.payload->>'work_id' WHERE p.payload->'value'->>'enabled'='true' AND (p.payload->'value'->>'hour')::integer*60+(p.payload->'value'->>'minute')::integer<=$2 AND (d.date IS NULL OR (d.payload->>'phase'='pending' AND d.payload->>'next_at'<=$3 AND (d.payload->>'work_id' IS NULL OR w.payload->>'status' NOT IN ('queued','running') OR w.id IS NULL))) ORDER BY coalesce(d.payload->>'next_at',''),p.user_id COLLATE "C" LIMIT $4`,
        [date, minute, now, limit],
      )
    ).rows as LightTickOwner[];
  }
  async save(o: LightTickOwner, row: ReadingScheduleDay, base: number) {
    const args = [
        o.appId,
        o.userId,
        row.date,
        row.revision,
        JSON.stringify(row),
      ],
      saved =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_reading_schedule_days(app_id,user_id,date,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING date",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_reading_schedule_days SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND date=$3 AND revision=$6 RETURNING date",
              [...args, base],
            );
    if (!saved.rows.length) fail(409, "Reading daily state changed");
    await appendDomainChange(this.query, o, {
      domain: "reading",
      resource: "day",
      id: row.date,
      revision: row.revision,
      operation: "upsert",
    });
  }
}

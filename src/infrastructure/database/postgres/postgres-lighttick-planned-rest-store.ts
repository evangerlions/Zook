import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { PlannedRestDate, PlannedRestStore } from "../../../modules/lighttick/planning/planned-rest-store.ts";
import { versionConflict } from "./postgres-lighttick-conflicts.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";

export class PostgresLightTickPlannedRestStore implements PlannedRestStore {
  constructor(private readonly query: QueryClient["query"]) {}

  async get(owner: LightTickOwner, date: string): Promise<PlannedRestDate | undefined> {
    const { rows } = await this.query(
      `SELECT planned_rest, version FROM zook_lighttick_planned_rest_dates
       WHERE app_id=$1 AND user_id=$2 AND date=$3::date`, [owner.appId, owner.userId, date]);
    const row = rows[0];
    return row ? { date, planned_rest: row.planned_rest === true, version: Number(row.version) } : undefined;
  }

  async list(owner: LightTickOwner, startsOn: string, endsOn: string): Promise<string[]> {
    const { rows } = await this.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM zook_lighttick_planned_rest_dates
       WHERE app_id=$1 AND user_id=$2 AND date BETWEEN $3::date AND $4::date AND planned_rest ORDER BY date`,
      [owner.appId, owner.userId, startsOn, endsOn]);
    return rows.map(row => String(row.date));
  }

  async save(owner: LightTickOwner, rest: PlannedRestDate): Promise<PlannedRestDate> {
    const values = [owner.appId, owner.userId, rest.date, rest.planned_rest, rest.version];
    const { rows } = rest.version === 1
      ? await this.query(`INSERT INTO zook_lighttick_planned_rest_dates (app_id, user_id, date, planned_rest, version)
        VALUES ($1,$2,$3::date,$4,$5) ON CONFLICT (app_id,user_id,date) DO NOTHING RETURNING version`, values)
      : await this.query(`UPDATE zook_lighttick_planned_rest_dates SET planned_rest=$4, version=$5
        WHERE app_id=$1 AND user_id=$2 AND date=$3::date AND version=$5-1 RETURNING version`, values);
    if (!rows[0]) versionConflict(rest.date);
    return rest;
  }
}

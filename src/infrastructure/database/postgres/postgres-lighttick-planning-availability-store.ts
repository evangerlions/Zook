import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { PlanningAvailability, PlanningAvailabilityStore } from "../../../modules/lighttick/planning/planning-availability-store.ts";
import { versionConflict } from "./postgres-lighttick-conflicts.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";

export class PostgresLightTickPlanningAvailabilityStore implements PlanningAvailabilityStore {
  constructor(private readonly query: QueryClient["query"]) {}

  async get(owner: LightTickOwner): Promise<PlanningAvailability | undefined> {
    const { rows } = await this.query(
      `SELECT available_weekdays, version FROM zook_lighttick_planning_availability
       WHERE app_id=$1 AND user_id=$2`, [owner.appId, owner.userId]);
    const row = rows[0];
    if (!row) return;
    return { available_weekdays: (row.available_weekdays as number[] | null)?.map(Number) ?? null, version: Number(row.version) };
  }

  async save(owner: LightTickOwner, availability: PlanningAvailability): Promise<PlanningAvailability> {
    const values = [owner.appId, owner.userId, availability.available_weekdays, availability.version];
    const { rows } = availability.version === 1
      ? await this.query(`INSERT INTO zook_lighttick_planning_availability (app_id, user_id, available_weekdays, version)
        VALUES ($1,$2,$3::smallint[],$4) ON CONFLICT (app_id,user_id) DO NOTHING RETURNING version`, values)
      : await this.query(`UPDATE zook_lighttick_planning_availability SET available_weekdays=$3::smallint[], version=$4
        WHERE app_id=$1 AND user_id=$2 AND version=$4-1 RETURNING version`, values);
    if (!rows[0]) versionConflict(owner.userId);
    return availability;
  }
}

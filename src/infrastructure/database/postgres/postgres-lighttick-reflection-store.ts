import type { LightTickReflectionRow } from "../../../modules/lighttick/lighttick-reflection.service.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresReflectionStore {
  constructor(private readonly query: Query, private readonly mapRow: <T>(row: Record<string, unknown>) => T) {}
  async listReflections(owner: LightTickOwner): Promise<LightTickReflectionRow[]> {
    const result = await this.query("SELECT * FROM zook_lighttick_reflections WHERE app_id=$1 AND user_id=$2 ORDER BY updated_at DESC", [owner.appId, owner.userId]);
    return result.rows.map(row => { const value = this.mapRow<LightTickReflectionRow>(row); value.planId = value.planId ?? undefined; return value; });
  }
  async saveReflection(row: LightTickReflectionRow, expectedVersion?: number): Promise<LightTickReflectionRow> {
    const result = expectedVersion === undefined
      ? await this.query(`INSERT INTO zook_lighttick_reflections
        (id,app_id,user_id,goal_id,plan_id,period_start,period_end,content,next_action,version,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,
        [row.id,row.appId,row.userId,row.goalId,row.planId ?? null,row.periodStart,row.periodEnd,row.content,row.nextAction,row.createdAt,row.updatedAt])
      : await this.query(`UPDATE zook_lighttick_reflections SET plan_id=$1,period_start=$2,period_end=$3,
        content=$4,next_action=$5,version=version+1,updated_at=$6
        WHERE app_id=$7 AND user_id=$8 AND id=$9 AND version=$10 RETURNING *`,
        [row.planId ?? null,row.periodStart,row.periodEnd,row.content,row.nextAction,row.updatedAt,row.appId,row.userId,row.id,expectedVersion]);
    if (!result.rows[0]) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Reflection version changed.");
    const saved = this.mapRow<LightTickReflectionRow>(result.rows[0]);
    saved.planId = saved.planId ?? undefined;
    return saved;
  }
}

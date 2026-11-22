import type { PlanningSession, PlanningSessionSummary } from '../../../modules/lighttick/planning/planning.types.ts';
import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import {ApplicationError} from '../../../shared/errors.ts';
import { mapRow } from './postgres-lighttick-row-mappers.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
const conflict=(id:string):never=>{throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Resource version is stale.',{resourceId:id});};
export class PostgresPlanningStore {
 constructor(private readonly query:Query){}
  async getPlanningSession(owner: LightTickOwner, id: string): Promise<PlanningSession | undefined> {
    const result = await this.query("SELECT payload,version FROM zook_lighttick_planning_sessions WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId,owner.userId,id]);
    return result.rows[0] ? { ...(result.rows[0].payload as PlanningSession), version: Number(result.rows[0].version) } : undefined;
  }
  async listPlanningSessions(owner: LightTickOwner, limit: number, goalId?: string, stageId?: string): Promise<PlanningSessionSummary[]> {
    const result = await this.query(`SELECT session.id, session.goal_id, goal.title AS goal_title, session.updated_at,
        session.payload->>'status' AS status, session.payload->>'draftPlanId' AS draft_plan_id,
        session.payload->>'draftExpiresAt' AS draft_expires_at, session.payload->>'previousPlanId' AS previous_plan_id,
        session.payload->>'stageId' AS stage_id,
        CASE WHEN session.payload#>>'{context,period_start,source}' IN ('user', 'confirmed', 'imported')
          THEN session.payload#>>'{context,period_start,value}' END AS "periodStart",
        CASE WHEN session.payload#>>'{context,period_end,source}' IN ('user', 'confirmed', 'imported')
          THEN session.payload#>>'{context,period_end,value}' END AS "periodEnd"
      FROM zook_lighttick_planning_sessions AS session
      JOIN zook_lighttick_goals AS goal
        ON goal.app_id = session.app_id AND goal.user_id = session.user_id AND goal.id = session.goal_id
      WHERE session.app_id = $1 AND session.user_id = $2
        AND ($4::text IS NULL OR session.goal_id = $4)
        AND ($5::text IS NULL OR session.payload->>'stageId' = $5)
      ORDER BY session.updated_at DESC, session.id DESC LIMIT $3`,
      [owner.appId, owner.userId, limit, goalId ?? null, stageId ?? null]);
    return result.rows.map(row => mapRow<PlanningSessionSummary>(row));
  }
  async savePlanningSession(row: PlanningSession, expectedVersion?: number): Promise<PlanningSession> {
    const result = expectedVersion === undefined
      ? await this.query(`INSERT INTO zook_lighttick_planning_sessions (id,app_id,user_id,goal_id,thread_id,payload,version,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,1,$7,$8) ON CONFLICT DO NOTHING RETURNING version`,
          [row.id,row.appId,row.userId,row.goalId,row.threadId,JSON.stringify(row),row.createdAt,row.updatedAt])
      : await this.query(`UPDATE zook_lighttick_planning_sessions SET payload=$1::jsonb,version=version+1,updated_at=$2
          WHERE app_id=$3 AND user_id=$4 AND id=$5 AND version=$6 RETURNING version`,
          [JSON.stringify(row),row.updatedAt,row.appId,row.userId,row.id,expectedVersion]);
    if (!result.rows[0]) conflict(row.id);
    return { ...row, version: Number(result.rows[0]!.version) };
  }
}

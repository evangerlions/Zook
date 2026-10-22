import type {PlanningSession} from '../../../modules/lighttick/planning/planning.types.ts';
import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import {ApplicationError} from '../../../shared/errors.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
const conflict=(id:string):never=>{throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Resource version is stale.',{resourceId:id});};
export class PostgresPlanningStore {
 constructor(private readonly query:Query){}
  async getPlanningSession(owner: LightTickOwner, id: string): Promise<PlanningSession | undefined> {
    const result = await this.query("SELECT payload,version FROM zook_lighttick_planning_sessions WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId,owner.userId,id]);
    return result.rows[0] ? { ...(result.rows[0].payload as PlanningSession), version: Number(result.rows[0].version) } : undefined;
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

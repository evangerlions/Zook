import type { LearningRouteRepository, LearningRoute, LearningRouteVersion, RouteLessonLink } from "../../../modules/lighttick/learning/learning-route.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { PostgresLearningWorkStore } from "./postgres-learning-work-store.ts";
type Query = (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;
type Transaction = <T>(owner: LightTickOwner, callback: () => Promise<T>) => Promise<T>;
export class PostgresLearningRouteStore implements LearningRouteRepository {
  readonly work=new PostgresLearningWorkStore((sql,args)=>this.query(sql,args),(o,fn)=>this.transaction(o,fn));
  constructor(private readonly query: Query, private readonly transaction: Transaction) {}
  async counts(o:LightTickOwner){
    const result:Record<string,number>={};
    for(const [key,table]of Object.entries({routes:'learning_routes',route_versions:'learning_route_versions',route_links:'learning_route_lessons',work:'learning_work'}))result[key]=Number((await this.query('SELECT count(*)::int AS n FROM zook_lighttick_'+table+' WHERE app_id=$1 AND user_id=$2',[o.appId,o.userId])).rows[0].n);
    return result;
  }
  async clearStaging(o:LightTickOwner){await this.transaction(o,async()=>{for(const table of ['learning_work','learning_route_lessons','learning_route_versions','learning_routes'])await this.query('DELETE FROM zook_lighttick_'+table+' WHERE app_id=$1 AND user_id=$2',[o.appId,o.userId]);});}
  async readRouteProgressFacts(o: LightTickOwner, id: string) {
    const r = await this.query(`SELECT l.number,l.lesson_id,n.published_version,p.completed,
      n.source_completed AND n.source_completed_version=n.published_version AS source_completed
      FROM zook_lighttick_learning_route_lessons l JOIN zook_lighttick_native_lessons n
      ON n.app_id=l.app_id AND n.user_id=l.user_id AND n.id=l.lesson_id
      LEFT JOIN zook_lighttick_native_learning_private p ON p.app_id=n.app_id AND p.user_id=n.user_id
      AND p.lesson_id=n.id AND p.content_version=n.published_version
      WHERE l.app_id=$1 AND l.user_id=$2 AND l.route_id=$3 AND n.published_version IS NOT NULL ORDER BY l.number`, [o.appId,o.userId,id]);
    return r.rows.map(x=>({number:x.number,lessonId:x.lesson_id,contentVersion:x.published_version,completed:x.completed===true,sourceCompleted:x.source_completed===true}));
  }
  async getLearningRoute(o: LightTickOwner, id: string) {
    return (await this.query("SELECT payload FROM zook_lighttick_learning_routes WHERE app_id=$1 AND user_id=$2 AND id=$3", [o.appId,o.userId,id])).rows[0]?.payload as LearningRoute | undefined;
  }
  async listLearningRoutes(o: LightTickOwner, after: string, limit: number, publishedOnly = false) {
    return (await this.query('SELECT payload FROM zook_lighttick_learning_routes WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 COLLATE "C" AND (NOT $5::boolean OR (payload->>\'publishedVersion\')::int>0) ORDER BY id COLLATE "C" LIMIT $4', [o.appId,o.userId,after,limit,publishedOnly])).rows.map(r => r.payload as LearningRoute);
  }
  async saveLearningRoute(row: LearningRoute, base: number) {
    return this.transaction(row, async () => {
      const args = [row.appId,row.userId,row.id,row.revision,JSON.stringify(row)];
      const r = base === 0
        ? await this.query("INSERT INTO zook_lighttick_learning_routes VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id", args)
        : await this.query("UPDATE zook_lighttick_learning_routes SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id", [...args,base]);
      if (!r.rows.length) throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Course route changed; preserve the local draft.");
    });
  }
  async getLearningRouteVersion(o: LightTickOwner, id: string, version: number) {
    return (await this.query("SELECT payload FROM zook_lighttick_learning_route_versions WHERE app_id=$1 AND user_id=$2 AND route_id=$3 AND version=$4",[o.appId,o.userId,id,version])).rows[0]?.payload as LearningRouteVersion | undefined;
  }
  async insertLearningRouteVersion(row: LearningRouteVersion) {
    await this.transaction(row, () => this.query("INSERT INTO zook_lighttick_learning_route_versions VALUES($1,$2,$3,$4,$5::jsonb)",[row.appId,row.userId,row.routeId,row.version,JSON.stringify(row)]));
  }
  async listRouteLessonLinks(o: LightTickOwner, id: string) {
    return (await this.query("SELECT payload FROM zook_lighttick_learning_route_lessons WHERE app_id=$1 AND user_id=$2 AND route_id=$3 ORDER BY number",[o.appId,o.userId,id])).rows.map(r => r.payload as RouteLessonLink);
  }
  async insertRouteLessonLink(row: RouteLessonLink) {
    await this.transaction(row, () => this.query("INSERT INTO zook_lighttick_learning_route_lessons VALUES($1,$2,$3,$4,$5,$6::jsonb)",[row.appId,row.userId,row.routeId,row.number,row.lessonId,JSON.stringify(row)]));
  }
}

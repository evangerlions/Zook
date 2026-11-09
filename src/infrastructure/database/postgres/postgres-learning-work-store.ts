import type { LearningWork, LearningWorkRepository } from "../../../modules/lighttick/learning/learning-work.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query=(sql:string,args?:unknown[])=>Promise<{rows:Record<string,any>[]} >;
export class PostgresLearningWorkStore implements LearningWorkRepository {
  constructor(private readonly query:Query,private readonly transaction:<T>(owner:LightTickOwner,fn:()=>Promise<T>)=>Promise<T>){}
  async get(o:LightTickOwner,id:string){return (await this.query("SELECT payload FROM zook_lighttick_learning_work WHERE app_id=$1 AND user_id=$2 AND id=$3",[o.appId,o.userId,id])).rows[0]?.payload as LearningWork|undefined;}
  async save(r:LearningWork,base:number){
    await this.transaction(r,async()=>{
      const args=[r.appId,r.userId,r.id,r.revision,r.status,r.leaseUntil,r.createdAt,JSON.stringify(r)];
      const result=base===0?await this.query("INSERT INTO zook_lighttick_learning_work VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",args):
        await this.query("UPDATE zook_lighttick_learning_work SET revision=$4,status=$5,lease_until=$6,created_at=$7,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$9 RETURNING id",[...args,base]);
      if(!result.rows.length)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Learning work changed.");
    });
  }
  async list(o:LightTickOwner,after:string,limit:number){return (await this.query('SELECT payload FROM zook_lighttick_learning_work WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 COLLATE "C" ORDER BY id COLLATE "C" LIMIT $4',[o.appId,o.userId,after,limit])).rows.map(r=>r.payload as LearningWork);}
  async recent(o:LightTickOwner,since:string){return (await this.query("SELECT payload FROM zook_lighttick_learning_work WHERE app_id=$1 AND user_id=$2 AND created_at>=$3 ORDER BY created_at DESC,id LIMIT 201",[o.appId,o.userId,since])).rows.map(r=>r.payload as LearningWork);}
  async recoverable(now:string,limit:number){return (await this.query("SELECT payload FROM zook_lighttick_learning_work WHERE status='queued' OR status='running' AND lease_until<=$1 ORDER BY created_at,id LIMIT $2",[now,limit])).rows.map(r=>r.payload as LearningWork);}
}

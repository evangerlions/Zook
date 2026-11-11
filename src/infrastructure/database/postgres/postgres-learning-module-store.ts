import type {LearningModule,LearningModuleRepository} from "../../../modules/lighttick/learning/learning-module.types.ts";
import type {LightTickOwner} from "../../../modules/lighttick/lighttick.types.ts";
import {ApplicationError} from "../../../shared/errors.ts";
type Query=(sql:string,args?:unknown[])=>Promise<{rows:Record<string,any>[]} >;
export class PostgresLearningModuleStore implements LearningModuleRepository {
 constructor(readonly query:Query){}
 async history(o:LightTickOwner,id:string,before:number,limit:number){return (await this.query("SELECT payload FROM zook_lighttick_learning_module_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision::bigint<$4::bigint ORDER BY revision DESC LIMIT $5",[o.appId,o.userId,id,before,limit])).rows.map(r=>r.payload as LearningModule);}
 async get(o:LightTickOwner,id:string){return (await this.query("SELECT payload FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2 AND id=$3",[o.appId,o.userId,id])).rows[0]?.payload as LearningModule|undefined;}
 async list(o:LightTickOwner,after:string,limit:number,filter:"active"|"archived"|"all"){
  return (await this.query('SELECT payload FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND ($4=\'all\' OR (payload->>\'archived\')::boolean=$5) ORDER BY id COLLATE "C" LIMIT $6',[o.appId,o.userId,after,filter,filter==="archived",limit])).rows.map(r=>r.payload as LearningModule);
 }
 async save(row:LearningModule,base:number){const args=[row.appId,row.userId,row.id,row.revision,JSON.stringify(row)];const r=base===0?await this.query("INSERT INTO zook_lighttick_learning_modules(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id",args):await this.query("UPDATE zook_lighttick_learning_modules SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id",[...args,base]);if(!r.rows.length)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","模块已变化，请保留本机输入并核对。");await this.query("INSERT INTO zook_lighttick_learning_module_versions(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)",args);}
}

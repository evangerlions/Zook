import type {ActionWorkspaceRow,ActionTicket,ActionLink,Json} from '../../../modules/lighttick/actions/action.types.ts';
import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import {ApplicationError} from '../../../shared/errors.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
const conflict=(id:string):never=>{throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','账户已连接。',{resourceId:id});};
export class PostgresActionStore {
 constructor(private readonly query:Query){}
 async getLearningLibrary(owner:LightTickOwner):Promise<Json|undefined>{const r=await this.query('SELECT payload FROM zook_lighttick_learning_libraries WHERE app_id=$1 AND user_id=$2',[owner.appId,owner.userId]);return r.rows[0]?.payload as Json|undefined;}
 async saveLearningLibrary(owner:LightTickOwner,data:Json){await this.query('INSERT INTO zook_lighttick_learning_libraries VALUES ($1,$2,$3::jsonb) ON CONFLICT(app_id,user_id) DO UPDATE SET payload=EXCLUDED.payload',[owner.appId,owner.userId,JSON.stringify(data)]);}

  async lockActionOwner(owner:LightTickOwner){await this.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`actions:${owner.appId}:${owner.userId}`]);}
  async getActionWorkspace(owner:LightTickOwner):Promise<ActionWorkspaceRow|undefined>{
    const r=await this.query('SELECT payload,version FROM zook_lighttick_action_workspaces WHERE app_id=$1 AND user_id=$2',[owner.appId,owner.userId]);
    return r.rows[0]?{...owner,data:r.rows[0].payload as ActionWorkspaceRow['data'],version:Number(r.rows[0].version)}:undefined;}
  async saveActionWorkspace(row:ActionWorkspaceRow){await this.query(`INSERT INTO zook_lighttick_action_workspaces VALUES ($1,$2,$3::jsonb,$4)
    ON CONFLICT(app_id,user_id) DO UPDATE SET payload=EXCLUDED.payload,version=EXCLUDED.version`,[row.appId,row.userId,JSON.stringify(row.data),row.version]);}
  async getActionTicket(hash:string):Promise<ActionTicket|undefined>{const r=await this.query('SELECT payload FROM zook_lighttick_action_tickets WHERE hash=$1',[hash]);return r.rows[0]?.payload as ActionTicket|undefined;}
  async saveActionTicket(row:ActionTicket){await this.query(`INSERT INTO zook_lighttick_action_tickets VALUES ($1,$2,$3,$4::jsonb,$5)
    ON CONFLICT(hash) DO UPDATE SET payload=EXCLUDED.payload`,[row.hash,row.appId,row.userId,JSON.stringify(row),row.expires_at]);}
  async getActionLink(source:string):Promise<ActionLink|undefined>{const r=await this.query('SELECT payload FROM zook_lighttick_action_links WHERE source_account_id=$1',[source]);return r.rows[0]?.payload as ActionLink|undefined;}
  async getOwnerActionLink(owner:LightTickOwner):Promise<ActionLink|undefined>{const r=await this.query('SELECT payload FROM zook_lighttick_action_links WHERE app_id=$1 AND user_id=$2',[owner.appId,owner.userId]);return r.rows[0]?.payload as ActionLink|undefined;}
  async saveActionLink(row:ActionLink){try{const r=await this.query(`INSERT INTO zook_lighttick_action_links VALUES ($1,$2,$3,$4::jsonb)
    ON CONFLICT(source_account_id) DO UPDATE SET payload=EXCLUDED.payload WHERE zook_lighttick_action_links.user_id=EXCLUDED.user_id RETURNING user_id`,[row.source_account_id,row.appId,row.userId,JSON.stringify(row)]);
    if(!r.rows[0])conflict(row.binding_id);
    }catch(e){if((e as {code?:string}).code==='23505')conflict(row.binding_id);throw e;}}
}

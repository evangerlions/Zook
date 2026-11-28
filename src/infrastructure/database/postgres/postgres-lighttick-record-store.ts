import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import type {LightTickRecord,LightTickRecordRow,RecordQuery} from '../../../modules/lighttick/lighttick-record.service.ts';
import {ApplicationError} from '../../../shared/errors.ts';
import { recordTextMatches } from './postgres-lighttick-record-match.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>
/** 游标拆成 date|created_at|id；兼容旧的 date:id 形式。 */
export function splitCursor(after:string):[string,string,string]{
 const parts=after.split('|');
 return parts.length===3?[parts[0],parts[1],parts[2]]:[after.slice(0,10),'',after.slice(11)];
}
export class PostgresRecordStore {
 constructor(private readonly query:Query){}
 async getRecord(owner:LightTickOwner,id:string):Promise<LightTickRecordRow|undefined> {
  const result=await this.query('SELECT payload,version FROM zook_lighttick_records WHERE app_id=$1 AND user_id=$2 AND id=$3',[owner.appId,owner.userId,id]);
  return result.rows[0]?{...owner,id,version:Number(result.rows[0].version),payload:result.rows[0].payload as LightTickRecord}:undefined;
 }
 async listRecords(owner:LightTickOwner,query?:RecordQuery):Promise<LightTickRecordRow[]> {
  const values:unknown[]=[owner.appId,owner.userId],where=['app_id=$1','user_id=$2'];
  const param=(value:unknown)=>{values.push(value);return '$'+values.length;};
  if(query?.date)where.push('record_date='+param(query.date)+'::date');
  if(query?.startsOn)where.push('record_date>='+param(query.startsOn)+'::date');
  if(query?.endsOn)where.push('record_date<='+param(query.endsOn)+'::date');
  if(query?.q)where.push(recordTextMatches(param(query.q.toLowerCase())));
  if(query&&query.archived!=='all')where.push(`(payload->>'archived_at') IS ${query.archived==='true'?'NOT ':''}NULL`);
  if(query?.after){
   // 游标是 date|created_at|id。同一天里按创建时间倒序，id 只在同一毫秒内做稳定兜底；
   // 老客户端发来的 date:id 仍然接受，created_at 当作空，只按 id 翻页。
   const [date,stamp,id]=splitCursor(query.after);
   const d=param(date);
   if(stamp){
    const c=param(stamp),i=param(id);
    where.push(`(record_date<${d}::date OR (record_date=${d}::date AND (COALESCE(payload->>'created_at','')<${c} OR (COALESCE(payload->>'created_at','')=${c} AND id COLLATE "C"<${i} COLLATE "C"))))`);
   } else {
    const i=param(id);
    where.push(`(record_date<${d}::date OR (record_date=${d}::date AND id COLLATE "C"<${i} COLLATE "C"))`);
   }
  }
  const limit=query?' LIMIT '+param(query.limit):'';
  const result=await this.query('SELECT id,payload,version FROM zook_lighttick_records WHERE '+where.join(' AND ')+` ORDER BY record_date DESC,COALESCE(payload->>'created_at','') DESC,id COLLATE "C" DESC`+limit,values);
  return result.rows.map(r=>({...owner,id:String(r.id),version:Number(r.version),payload:r.payload as LightTickRecord}));
 }

 async recordVersions(owner:LightTickOwner,id:string):Promise<LightTickRecord[]> {
  return (await this.query('SELECT payload FROM zook_lighttick_record_versions WHERE app_id=$1 AND user_id=$2 AND record_id=$3 ORDER BY version DESC',[owner.appId,owner.userId,id])).rows.map(r=>r.payload as LightTickRecord);
 }
 async getRecordVersion(owner:LightTickOwner,id:string,version:number):Promise<LightTickRecord|undefined>{
  const row=(await this.query('SELECT payload FROM zook_lighttick_record_versions WHERE app_id=$1 AND user_id=$2 AND record_id=$3 AND version=$4',[owner.appId,owner.userId,id,version])).rows[0];return row?.payload as LightTickRecord|undefined;
 }
 async saveRecord(row:LightTickRecordRow,baseVersion:number) {
  const args=[row.appId,row.userId,row.id,JSON.stringify(row.payload),row.payload.record_date,row.payload.updated_at];
  const result=baseVersion===0?await this.query(`INSERT INTO zook_lighttick_records(app_id,user_id,id,payload,record_date,updated_at,version)
   VALUES($1,$2,$3,$4::jsonb,$5,$6,1) ON CONFLICT DO NOTHING RETURNING version`,args):
   await this.query(`UPDATE zook_lighttick_records SET payload=$4::jsonb,record_date=$5,updated_at=$6,version=version+1
    WHERE app_id=$1 AND user_id=$2 AND id=$3 AND version=$7 RETURNING version`,[...args,baseVersion]);
  if(!result.rows[0]) throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Record version changed.');
  await this.query(`INSERT INTO zook_lighttick_record_versions(app_id,user_id,record_id,version,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,[row.appId,row.userId,row.id,row.version,JSON.stringify(row.payload)]);
  await this.query(`INSERT INTO zook_lighttick_change_log(app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot,changed_at)
   VALUES($1,$2,'record',$3,$4,'upsert',$5::jsonb,$6)`,[row.appId,row.userId,row.id,row.version,JSON.stringify(row.payload),row.payload.updated_at]);
 }
}

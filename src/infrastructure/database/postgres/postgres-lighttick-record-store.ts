import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import type {LightTickRecord,LightTickRecordRow,RecordQuery} from '../../../modules/lighttick/lighttick-record.service.ts';
import {ApplicationError} from '../../../shared/errors.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>
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
  if(query?.q){const key=param(query.q.toLowerCase());where.push(`(position(${key} in lower(payload->>'raw_text'))>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(payload->'tags') tag WHERE position(${key} in lower(tag))>0))`);}
  if(query&&query.archived!=='all')where.push(`(payload->>'archived_at') IS ${query.archived==='true'?'NOT ':''}NULL`);
  if(query?.after){const date=param(query.after.slice(0,10)),id=param(query.after.slice(11));where.push(`(record_date<${date}::date OR (record_date=${date}::date AND id COLLATE "C"<${id} COLLATE "C"))`);}
  const limit=query?' LIMIT '+param(query.limit):'';
  const result=await this.query('SELECT id,payload,version FROM zook_lighttick_records WHERE '+where.join(' AND ')+' ORDER BY record_date DESC,id COLLATE "C" DESC'+limit,values);
  return result.rows.map(r=>({...owner,id:String(r.id),version:Number(r.version),payload:r.payload as LightTickRecord}));
 }

 async recordVersions(owner:LightTickOwner,id:string):Promise<LightTickRecord[]> {
  return (await this.query('SELECT payload FROM zook_lighttick_record_versions WHERE app_id=$1 AND user_id=$2 AND record_id=$3 ORDER BY version DESC',[owner.appId,owner.userId,id])).rows.map(r=>r.payload as LightTickRecord);
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

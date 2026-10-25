import type {RecordTransferRow,RecordTransferTicket} from '../../../modules/lighttick/records/record-transfer.types.ts';
import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import type {LightTickRecordRow,LightTickRecord} from '../../../modules/lighttick/lighttick-record.service.ts';
import {ApplicationError} from '../../../shared/errors.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>;
export class PostgresRecordTransferStore {
 constructor(private readonly query:Query){}
 async lockRecordSource(key:string){await this.query('SELECT pg_advisory_xact_lock(hashtext($1))',['record-source:'+key]);}
 async getRecordTransfer(key:string):Promise<RecordTransferRow|undefined>{return (await this.query('SELECT payload FROM zook_lighttick_record_transfers WHERE source_key=$1',[key])).rows[0]?.payload as RecordTransferRow|undefined;}
 async getOwnerRecordTransfer(owner:LightTickOwner):Promise<RecordTransferRow|undefined>{return (await this.query('SELECT payload FROM zook_lighttick_record_transfers WHERE app_id=$1 AND user_id=$2',[owner.appId,owner.userId])).rows[0]?.payload as RecordTransferRow|undefined;}
 async saveRecordTransfer(row:RecordTransferRow){
  try {
   const saved=await this.query(`INSERT INTO zook_lighttick_record_transfers(source_key,app_id,user_id,payload) VALUES($1,$2,$3,$4::jsonb)
    ON CONFLICT(source_key) DO UPDATE SET payload=EXCLUDED.payload WHERE zook_lighttick_record_transfers.app_id=EXCLUDED.app_id AND zook_lighttick_record_transfers.user_id=EXCLUDED.user_id RETURNING source_key`,[row.sourceKey,row.appId,row.userId,JSON.stringify(row)]);
   if(!saved.rows[0])throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Record source is already bound.');
  } catch(e){if((e as {code?:string}).code==='23505')throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Record target is already bound.');throw e;}
 }
 async getRecordTransferTicket(hash:string):Promise<RecordTransferTicket|undefined>{return (await this.query('SELECT payload FROM zook_lighttick_record_tickets WHERE hash=$1',[hash])).rows[0]?.payload as RecordTransferTicket|undefined;}
 async saveRecordTransferTicket(row:RecordTransferTicket){await this.query(`INSERT INTO zook_lighttick_record_tickets(hash,app_id,user_id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(hash) DO UPDATE SET payload=EXCLUDED.payload`,[row.hash,row.appId,row.userId,JSON.stringify(row)]);}
 async importRecord(row:LightTickRecordRow,versions:LightTickRecord[],history:Record<string,unknown>){
  const result=await this.query(`INSERT INTO zook_lighttick_records(app_id,user_id,id,payload,record_date,version,updated_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[row.appId,row.userId,row.id,JSON.stringify(row.payload),row.payload.record_date,row.version,row.payload.updated_at]);
  if(!result.rows[0])throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Imported record collides with an existing record.');
  for(const version of versions)await this.query(`INSERT INTO zook_lighttick_record_versions(app_id,user_id,record_id,version,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,[row.appId,row.userId,row.id,version.version,JSON.stringify(version)]);
  await this.query(`INSERT INTO zook_lighttick_record_source_history(app_id,user_id,record_id,payload) VALUES($1,$2,$3,$4::jsonb)`,[row.appId,row.userId,row.id,JSON.stringify(history)]);
  await this.query(`INSERT INTO zook_lighttick_change_log(app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot,changed_at) VALUES($1,$2,'record',$3,$4,'upsert',$5::jsonb,$6)`,[row.appId,row.userId,row.id,row.version,JSON.stringify(row.payload),row.payload.updated_at]);
 }
 async recordSourceHistory(owner:LightTickOwner,id:string){return (await this.query('SELECT payload FROM zook_lighttick_record_source_history WHERE app_id=$1 AND user_id=$2 AND record_id=$3',[owner.appId,owner.userId,id])).rows[0]?.payload as Record<string,unknown>|undefined;}
}

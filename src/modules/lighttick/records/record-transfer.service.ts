import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {LightTickRepository} from '../lighttick.repository.ts';
import type {LightTickOwner} from '../lighttick.types.ts';
import {LightTickRecordService} from '../lighttick-record.service.ts';
import type {RecordSource,RecordTransferRow} from './record-transfer.types.ts';
import {canonical,digest,fail,sourceKey,mappedRecordId,validatePackage} from './record-transfer.validation.ts';

type Json=Record<string,any>;
export class RecordTransferService {
 constructor(readonly repository:LightTickRepository,readonly configuration:{sourceInstance:string;secret:string},readonly clock=()=>new Date(),readonly authorize:(owner:LightTickOwner)=>Promise<void>=async()=>{}){}
 private configured(source?:RecordSource){if(this.configuration.secret.length<32||!this.configuration.sourceInstance)fail(503,'Record handoff is not configured.');if(source&&(source.instance!==this.configuration.sourceInstance||typeof source.subject!=='string'||!source.subject||source.subject.length>160))fail(403,'Untrusted record source.');}
 async ticket(owner:LightTickOwner){this.configured();return this.repository.transaction(owner,async()=>{
  await this.repository.lockRecordOwner(owner);await this.authorize(owner);
  const code=randomBytes(18).toString('hex'),expires_at=new Date(this.clock().getTime()+300000).toISOString();
  await this.repository.saveRecordTransferTicket({...owner,hash:digest(code),expires_at});return {code,expires_at,user_id:owner.userId,scope:'records'};
 });}
 private async requireTicket(source:RecordSource,code:string){
  this.configured(source);if(typeof code!=='string'||!/^[a-f0-9]{36}$/.test(code))fail(422,'Invalid record link code.');
  const ticket=await this.repository.getRecordTransferTicket(digest(code));
  if(!ticket||Date.parse(ticket.expires_at)<=this.clock().getTime()||ticket.claimed_source&&ticket.claimed_source!==sourceKey(source))fail(409,'Record link code is expired or already claimed.');return ticket;
 }
 async preview(source:RecordSource,code:string){const ticket=await this.requireTicket(source,code);return {target_user_id:ticket.userId,expires_at:ticket.expires_at,scope:'records',source_instance:source.instance};}
 async claim(source:RecordSource,input:{code:string;operation_id:string}){
  const ticket=await this.requireTicket(source,input.code);
  if(typeof input.operation_id!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(input.operation_id))fail(422,'Invalid handoff operation.');
  return this.repository.transaction(ticket,async()=>{
   await this.repository.lockRecordSource(sourceKey(source));await this.repository.lockRecordOwner(ticket);await this.authorize(ticket);
   const current=await this.requireTicket(source,input.code),existing=await this.repository.getRecordTransfer(sourceKey(source)),target=await this.repository.getOwnerRecordTransfer(ticket);
   if(existing&&(existing.userId!==ticket.userId||existing.phase!=='cancelled'&&existing.operation_id!==input.operation_id)||target&&target.sourceKey!==sourceKey(source)||current.operation_id&&current.operation_id!==input.operation_id)fail(409,'A source or target is already bound to another handoff.');
   const row:RecordTransferRow=(existing?.phase!=='cancelled'?existing:undefined)??{...ticket,sourceKey:sourceKey(source),source,binding_id:'record-binding-'+randomUUID(),operation_id:input.operation_id,phase:'prepared'};
   await this.repository.saveRecordTransfer(row);await this.repository.saveRecordTransferTicket({...current,claimed_source:sourceKey(source),operation_id:input.operation_id});return this.public(row);
  });
 }
 async linked(source:RecordSource){this.configured(source);const row=await this.repository.getRecordTransfer(sourceKey(source));if(!row)fail(404,'Record source is not bound.');return row;}
 async status(owner:LightTickOwner){const row=await this.repository.getOwnerRecordTransfer(owner);return row?this.public(row):{phase:'unlinked',scope:'records'};}
 private public(row:RecordTransferRow){return {phase:row.phase,scope:'records',binding_id:row.binding_id,target_user_id:row.userId,operation_id:row.operation_id,snapshot_hash:row.snapshot_hash,source_instance:row.source.instance,receipt:row.receipt};}
 private match(row:RecordTransferRow,input:Json){if(row.binding_id!==input.binding_id||row.operation_id!==input.operation_id)fail(409,'Record handoff operation does not match.');}
 async stage(source:RecordSource,input:Json){
  const link=await this.linked(source);return this.repository.transaction(link,async()=>{
   await this.repository.lockRecordOwner(link);const row=await this.linked(source);this.match(row,input);
   if(!['prepared','staged'].includes(row.phase))fail(409,'This handoff cannot stage records.');
   const snapshot=validatePackage(input.snapshot,source,row.operation_id),hash=digest(snapshot);
   if(hash!==input.snapshot_hash)fail(422,'Record snapshot hash does not match.');
   if(row.snapshot_hash){if(row.snapshot_hash!==hash)fail(409,'A different snapshot is already staged.');return this.public(row);}
   const next={...row,snapshot_hash:hash,snapshot,phase:'staged' as const};await this.repository.saveRecordTransfer(next);return this.public(next);
  });
 }
 async activate(source:RecordSource,input:Json){
  const link=await this.linked(source);return this.repository.transaction(link,async()=>{
   await this.repository.lockRecordOwner(link);const row=await this.linked(source);this.match(row,input);
   const receipt=input.freeze_receipt;
   if(!receipt||receipt.scope!=='records'||receipt.phase!=='frozen'||receipt.binding_id!==row.binding_id||receipt.operation_id!==row.operation_id||receipt.snapshot_hash!==row.snapshot_hash||input.snapshot_hash!==row.snapshot_hash||receipt.source_instance!==source.instance||receipt.source_subject!==source.subject)fail(409,'A matching source freeze receipt is required.');
   const {signature,...payload}=receipt;const expected=createHmac('sha256',this.configuration.secret).update(canonical(payload)).digest('hex');
   if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail(403,'Invalid source freeze receipt.');
   if(row.phase==='active'||row.phase==='readonly')return row.receipt!;
   if(row.phase!=='staged'||!row.snapshot)fail(409,'No verified source package is staged.');
   for(const entry of row.snapshot.entries){
    const id=mappedRecordId(source,entry.source_id),sourceInfo={instance:source.instance,id:entry.source_id,imported_at:this.clock().toISOString(),missing_versions:entry.missing_versions??[]};
    const versions=[...entry.versions];if(!versions.some(v=>v.version===entry.record.version))versions.push(entry.record);
    const record={...entry.record,id,source:sourceInfo};
    await this.repository.importRecord({...row,id,version:record.version,payload:record},versions.map(v=>({...v,id,source:sourceInfo})),{source:sourceInfo,private_history:entry.private_history,source_record:entry.record,source_versions:entry.versions});
   }
   const result={binding_id:row.binding_id,target_user_id:row.userId,operation_id:row.operation_id,snapshot_hash:row.snapshot_hash,source_counts:{records:row.snapshot.entries.length,versions:row.snapshot.entries.reduce((sum,e)=>sum+e.versions.length,0)},activated_at:this.clock().toISOString(),phase:'active'};
   await this.repository.saveRecordTransfer({...row,phase:'active',receipt:result});return result;
  });
 }
 async cancel(source:RecordSource,input:Json){
  const link=await this.linked(source);return this.repository.transaction(link,async()=>{
   await this.repository.lockRecordOwner(link);const row=await this.linked(source);this.match(row,input);
   if(['active','readonly'].includes(row.phase))fail(409,'Active records must remain frozen; export the latest target state for recovery.');
   await this.repository.saveRecordTransfer({...row,phase:'cancelled',snapshot:undefined,snapshot_hash:undefined});return {phase:'cancelled',binding_id:row.binding_id,operation_id:row.operation_id};
  });
 }
 async setReadonly(owner:LightTickOwner){return this.repository.transaction(owner,async()=>{await this.repository.lockRecordOwner(owner);const row=await this.repository.getOwnerRecordTransfer(owner);if(!row||!['active','readonly'].includes(row.phase))fail(409,'No active handoff.');await this.repository.saveRecordTransfer({...row,phase:'readonly'});return {phase:'readonly',export:await new LightTickRecordService(this.repository).export(owner)};});}
 async bridge(source:RecordSource,headers:Record<string,string>,input:Json){
  this.configured(source);const timestamp=headers['x-grow-timestamp']??'',nonce=headers['x-grow-nonce']??'',signature=headers['x-grow-signature']??'';
  if(!/^\d{10}$/.test(timestamp)||Math.abs(this.clock().getTime()/1000-Number(timestamp))>120||!/^[a-zA-Z0-9_-]{16,100}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))fail(403,'Invalid or expired source proof.');
  const expected=createHmac('sha256',this.configuration.secret).update([source.instance,source.subject,timestamp,nonce,canonical(input)].join('\n')).digest('hex');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))fail(403,'Invalid source proof.');
  const owner=['preview','claim'].includes(input.action)?await this.requireTicket(source,input.code):await this.linked(source);
  return this.repository.transaction(owner,async()=>{
   await this.repository.lockRecordSource(sourceKey(source));await this.repository.lockRecordOwner(owner);await this.authorize(owner);const key='record-proof-'+digest({source,nonce});
   if(await this.repository.getOperation(owner,key))fail(403,'Source proof was already consumed.');
   const now=this.clock().toISOString();await this.repository.saveOperation({...owner,operationId:key,deviceId:'grow-proof',payloadHash:digest(input),entityType:'record-proof',entityId:'records',action:input.action,requestPayload:{},resultPayload:{},status:'accepted',createdAt:now,updatedAt:now});
   if(input.action==='preview')return this.preview(source,input.code);
   if(input.action==='claim')return this.claim(source,input);
   if(input.action==='cancel')return this.cancel(source,input);
   if(input.action==='stage')return this.stage(source,input);
   if(input.action==='activate')return this.activate(source,input);
   if(input.action==='status')return this.public(await this.linked(source));
   if(input.action==='request')return this.request(source,input);
   fail(422,'Unsupported record bridge operation.');
  });
 }
 async request(source:RecordSource,input:Json){
  const row=await this.linked(source);if(!['active','readonly'].includes(row.phase))fail(409,'Records are not yet active.');
  const service=new LightTickRecordService(this.repository),id=typeof input.id==='string'&&input.id.startsWith('ref-')?mappedRecordId(source,input.id):input.id;
  if(input.method==='GET'){
   if(input.path==='list')return service.list(row,input.query??{});
   if(input.path==='detail')return {record:await service.get(row,id),versions:(await service.versions(row,id)).items,source_history:await this.repository.recordSourceHistory(row,id)};
   if(input.path==='export')return service.export(row);
   if(input.path==='attempt'){
    for(const record of await this.repository.listRecords(row)){const history=await this.repository.recordSourceHistory(row,record.id);const attempt=(history?.private_history as Json)?.attempts?.find((a:Json)=>a.id===input.id);if(attempt)return attempt;}fail(404,'Historical AI attempt was not found.');
   }
  }
  if(input.method==='PUT'||input.method==='POST'){
   if(row.phase!=='active')fail(423,'Records are read-only during recovery.');
   if(!['save','archive','restore'].includes(input.path))fail(409,'This release only reads imported AI history.');
   return service.mutate(row,id,input.path,input.body,input.key);
  }
  fail(422,'Unsupported record bridge request.');
 }
}

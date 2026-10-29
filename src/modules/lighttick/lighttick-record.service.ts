import type { LightTickOwner } from './lighttick.types.ts';
import type { LightTickRepository } from './lighttick.repository.ts';
import { ApplicationError } from '../../shared/errors.ts';
import { sha256 } from '../../shared/utils.ts';

export interface RecordContent {
 raw_text: string; record_date: string; prompt_kind: 'free'|'learning'|'difficulty'|'decision';
 guided_answers: Record<string,string>; tags: string[]; adopted_summary?: string; summary_basis_version?: number;
}
export interface LightTickRecord extends RecordContent {
 source?: {instance:string;id:string;imported_at:string;missing_versions:number[]};
 id: string; version: number; archived_at?: string; created_at: string; updated_at: string;
}
export interface LightTickRecordRow extends LightTickOwner { id: string; version: number; payload: LightTickRecord; }
const invalid = () => new ApplicationError(400,'REQ_FIELD_INVALID','Record fields, date or version are invalid.');
export function validateRecord(input: Record<string,unknown>): RecordContent {
 const allowed=['raw_text','record_date','prompt_kind','guided_answers','tags','adopted_summary','summary_basis_version','base_version'];
 if(Object.keys(input).some(k=>!allowed.includes(k)) || typeof input.raw_text!=='string' || !input.raw_text.trim() || input.raw_text.length>10000 ||
 typeof input.record_date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.record_date) || input.record_date<'0001-01-01' || !Number.isFinite(Date.parse(input.record_date)) || new Date(input.record_date).toISOString().slice(0,10)!==input.record_date ||
 !['free','learning','difficulty','decision'].includes(String(input.prompt_kind ?? 'free'))) throw invalid();
 const answers=input.guided_answers ?? {}; const tags=input.tags ?? [];
 if(!answers || typeof answers!=='object' || Array.isArray(answers) || Object.keys(answers).length>12 || Object.entries(answers).some(([k,v])=>k.length>100 || typeof v!=='string' || v.length>2000) ||
 !Array.isArray(tags) || tags.length>20 || tags.some(v=>typeof v!=='string' || !v.trim() || v.length>50) ||
 (input.adopted_summary!==undefined && (typeof input.adopted_summary!=='string' || input.adopted_summary.length>10000)) ||
 (input.summary_basis_version!==undefined && (!Number.isInteger(input.summary_basis_version) || Number(input.summary_basis_version)<1 || Number(input.summary_basis_version)>Number(input.base_version))) ||
 (input.adopted_summary!==undefined && input.summary_basis_version===undefined)) throw invalid();
 return {raw_text:input.raw_text,record_date:input.record_date,prompt_kind:(input.prompt_kind ?? 'free') as RecordContent['prompt_kind'],
 guided_answers:answers as Record<string,string>,tags:tags as string[],
 ...(input.adopted_summary!==undefined ? {adopted_summary:input.adopted_summary as string,summary_basis_version:input.summary_basis_version as number} : {})};
}
function canonical(value: unknown): string {
 if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 if(value && typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
export class LightTickRecordService {
 constructor(private readonly repository:LightTickRepository,private readonly clock=()=>new Date(),private readonly authorize: (owner:LightTickOwner)=>Promise<void>=async()=>{}){}
 async get(owner:LightTickOwner,id:string) {
  const row=await this.repository.getRecord(owner,id);
  if(!row) throw new ApplicationError(404,'LIGHTTICK_RESOURCE_NOT_FOUND','Record was not found.');
  return row.payload;
 }
 async versions(owner:LightTickOwner,id:string) { await this.get(owner,id); return {items:await this.repository.recordVersions(owner,id)}; }
 async list(owner:LightTickOwner,query:Record<string,string|undefined>={}) {
  const limit=query.limit===undefined?50:Number(query.limit);
  if(!Number.isInteger(limit)||limit<1||limit>200||!['true','false','all',undefined].includes(query.archived)|| (query.q?.length ?? 0)>200) throw invalid();
  if(query.date && (query.date<'0001-01-01'||!/^\d{4}-\d{2}-\d{2}$/.test(query.date)||!Number.isFinite(Date.parse(query.date))||new Date(query.date).toISOString().slice(0,10)!==query.date)) throw invalid();
  let after:string|undefined;
  if(query.cursor) { try {const v=JSON.parse(Buffer.from(query.cursor,'base64url').toString());
   if(v.owner!==sha256(owner.appId+':'+owner.userId)||v.filter!==sha256(canonical({date:query.date??'',q:query.q??'',archived:query.archived??'false'}))||typeof v.after!=='string'||v.after<'0001-01-01:'||!/^\d{4}-\d{2}-\d{2}:[a-zA-Z0-9_-]{8,128}$/.test(v.after)||!Number.isFinite(Date.parse(v.after.slice(0,10)))||new Date(v.after.slice(0,10)).toISOString().slice(0,10)!==v.after.slice(0,10)) throw invalid(); after=v.after;
  } catch {throw invalid();} }
  const rows=(await this.repository.listRecords(owner,{date:query.date,q:query.q,archived:query.archived??'false',after,limit:limit+1})).map(r=>r.payload);
  const items=rows.slice(0,limit);
  return {items,has_more:rows.length>limit,next_cursor:rows.length>limit?Buffer.from(JSON.stringify({owner:sha256(owner.appId+':'+owner.userId),filter:sha256(canonical({date:query.date??'',q:query.q??'',archived:query.archived??'false'})),after:items.at(-1)!.record_date+':'+items.at(-1)!.id})).toString('base64url'):undefined};
 }
 async mutate(owner:LightTickOwner,id:string,action:'save'|'archive'|'restore',input:Record<string,unknown>,key:string) {
  if(!/^[a-zA-Z0-9_-]{8,128}$/.test(id)||!Number.isInteger(input.base_version)||Number(input.base_version)<0||!key||key.length<8||key.length>128) throw invalid();
  const content=action==='save'?validateRecord(input):undefined;
  if(action!=='save' && Object.keys(input).some(k=>k!=='base_version')) throw invalid();
  const hash=sha256(canonical({id,action,input}));
  return this.repository.transaction(owner,async()=>{
   await this.repository.lockRecordOwner(owner);
   await this.authorize(owner);
   const transfer=await this.repository.getOwnerRecordTransfer(owner);
   if(transfer?.phase==="readonly") throw new ApplicationError(423,"LIGHTTICK_RECORDS_READONLY","Records are read-only during recovery.");
   const previous=await this.repository.getOperation(owner,key);
   if(previous) {
    if(previous.payloadHash!==hash||previous.entityType!=='record'||previous.entityId!==id) throw new ApplicationError(409,'LIGHTTICK_IDEMPOTENCY_MISMATCH','Request key was already used.');
    return previous.resultPayload as unknown as LightTickRecord;
   }
   const current=await this.repository.getRecord(owner,id);
   if(!current && action!=='save') throw new ApplicationError(404,'LIGHTTICK_RESOURCE_NOT_FOUND','Record was not found.');
   if((current?.version??0)!==input.base_version) throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Record changed. Reload before saving.');
   const now=this.clock().toISOString();
   const record:LightTickRecord={...(content??current!.payload),id,version:Number(input.base_version)+1,
    created_at:current?.payload.created_at??now,updated_at:now,
    ...(current?.payload.source?{source:current.payload.source}:{}),
    ...(current?.payload.archived_at?{archived_at:current.payload.archived_at}:{})};
   if(action==='archive') record.archived_at=now;
   if(action==='restore') delete record.archived_at;
   await this.repository.saveRecord({...owner,id,version:record.version,payload:record},Number(input.base_version));
   await this.repository.saveOperation({...owner,operationId:key,deviceId:'http',payloadHash:hash,entityType:'record',entityId:id,action,
    requestPayload:input,resultPayload:record as unknown as Record<string,unknown>,status:'accepted',createdAt:now,updatedAt:now});
   return record;
  });
 }
 async export(owner:LightTickOwner) {
  return this.repository.transaction(owner,async()=>{await this.repository.lockRecordOwner(owner);
   const rows=await this.repository.listRecords(owner);
   return {format_version:1,exported_at:this.clock().toISOString(),records:await Promise.all(rows.map(async r=>({record:r.payload,versions:await this.repository.recordVersions(owner,r.id),source_history:await this.repository.recordSourceHistory(owner,r.id)})))};
  });
 }
}

export interface RecordQuery { date?:string; q?:string; archived:string; after?:string; limit:number; }
export function selectRecordRows(rows:LightTickRecordRow[],query:RecordQuery):LightTickRecordRow[] {
 return rows.filter(({payload:r})=>(query.archived==='all'||Boolean(r.archived_at)===(query.archived==='true'))&&
  (!query.date||r.record_date===query.date)&&(!query.q||r.raw_text.toLowerCase().includes(query.q.toLowerCase())||r.tags.some(t=>t.toLowerCase().includes(query.q!.toLowerCase())))&&
  (!query.after||r.record_date+':'+r.id<query.after))
  .sort((a,b)=>{const x=a.payload.record_date+':'+a.id,y=b.payload.record_date+':'+b.id;return x===y?0:x<y?1:-1;}).slice(0,query.limit);
}

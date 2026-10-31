import {ApplicationError} from '../../../shared/errors.ts';
import {createHash} from 'node:crypto';
import {canonical,digest,object} from '../actions/action.validation.ts';
import {validateRecord,type LightTickRecord} from '../lighttick-record.service.ts';
import type {RecordPackage,RecordSource} from './record-transfer.types.ts';
export {canonical,digest};
export const fail=(status:number,message:string):never=>{throw new ApplicationError(status,status===409?'LIGHTTICK_VERSION_CONFLICT':status===404?'LIGHTTICK_RESOURCE_NOT_FOUND':status===403?'APP_SCOPE_FORBIDDEN':'REQ_FIELD_INVALID',message);};
export function sourceKey(source:RecordSource) {return createHash('sha256').update(canonical(source)).digest('hex');}
export function mappedRecordId(source:RecordSource,id:string){return 'grow-'+digest({...source,id});}
function scan(value:unknown,depth=0) {
 if(depth>16)fail(422,'Source history is too deeply nested.');
 if(Array.isArray(value)){for(const v of value)scan(v,depth+1);}
 else if(value&&typeof value==='object')for(const [key,v]of Object.entries(value)){
  if(/(^|_)(password|secret|api_?key|access_?token|refresh_?token|cookie|authorization|ai_config)($|_)/i.test(key))fail(422,'Credentials are not accepted in record packages.');scan(v,depth+1);
 }
}
function record(value:unknown,id:string):LightTickRecord {
 const v=object(value);
 if(v.id!==id||!Number.isInteger(v.version)||v.version<1||v.version>2147483646||typeof v.created_at!=='string'||typeof v.updated_at!=='string'||![v.created_at,v.updated_at].every(t=>Number.isFinite(Date.parse(t)))||v.archived_at!==undefined&&!Number.isFinite(Date.parse(v.archived_at)))fail(422,'Source record identity or timestamps are invalid.');
 validateRecord({raw_text:v.raw_text,record_date:v.record_date,prompt_kind:v.prompt_kind,guided_answers:v.guided_answers,tags:v.tags,...(v.adopted_summary!==undefined?{adopted_summary:v.adopted_summary,summary_basis_version:v.summary_basis_version}:{}),base_version:v.version});
 return v as LightTickRecord;
}
export function validatePackage(value:unknown,source:RecordSource,operationId:string):RecordPackage {
 const p=object(value);
 if(Buffer.byteLength(canonical(p))>4*1024*1024)fail(413,'Record package exceeds 4 MiB.');
 if(p.format_version!==1||p.source_instance!==source.instance||p.source_subject!==source.subject||p.operation_id!==operationId||!Array.isArray(p.entries)||p.entries.length>10000)fail(422,'Record package scope does not match the verified source.');
 scan(p);const ids=new Set();
 for(const entry of p.entries){
  const id=entry?.source_id;
  if(typeof id!=='string'||!/^ref-[a-f0-9]{32}$/.test(id)||ids.has(id)||!Array.isArray(entry.versions)||entry.versions.length>10000)fail(422,'Source record IDs or versions are invalid.');ids.add(id);
  const current=record(entry.record,id),seen=new Set<number>();
  for(const version of entry.versions){record(version,id);if(seen.has(version.version)||version.version>current.version)fail(422,'Source history version collision.');seen.add(version.version);if(version.version===current.version&&digest(version)!==digest(current))fail(422,'Current source version does not match its history.');}
  // Current state is an observed source snapshot; missing older versions must be explicit, never invented.
  seen.add(current.version);const missing=[];
  if(current.version>20000)fail(422,'Source version coverage is too large.');
  for(let v=1;v<current.version;v++)if(!seen.has(v))missing.push(v);
  if(digest(missing)!==digest(entry.missing_versions??[]))fail(422,'Source history gaps must be declared.');
  object(entry.private_history);
 }
 return p as RecordPackage;
}

import {createHmac,timingSafeEqual} from 'node:crypto';
import {ApplicationError} from '../../../shared/errors.ts';
import type {ActionLink,ActionContentEvent,ActionWorkspace,Json} from './action.types.ts';
import type {ActionService} from './action.service.ts';
import {canonical,digest,object,text,target,keys,getPlan,reject,sameTarget,businessDay} from './action.validation.ts';
import {reconcileContent} from './action.facts.ts';

/** Private Grow infrastructure only. Ordinary action writes and handoff stay closed. */
export class ActionSourceService {
 constructor(readonly actions:ActionService,readonly secret:string,readonly clock=()=>new Date()){}
 private async binding(link:ActionLink,b:Json){
  if(b.action_schema_version!==2)reject(409,'Source schema version must be integer 2.','CONTRACT_UPGRADE_REQUIRED',{reason:'CONTRACT_SCHEMA_VERSION'});
  const current=await this.actions.repository.getActionLink(link.source_account_id);
  if(!current||current.userId!==link.userId||current.binding_id!==link.binding_id||current.binding_id!==b.binding_id)reject(404,'Source binding not found.');
  if(current.phase!=='active')reject(409,'Source handoff is pending.');
  if(this.secret.length<32)reject(503,'Source delivery is not configured.','SOURCE_DELIVERY_UNAVAILABLE');
 }
 private sign(value:unknown){return createHmac('sha256',this.secret).update('grow-source-context-v1\n'+canonical(value)).digest('hex');}
 async context(link:ActionLink,input:Json){
  keys(input,['action','action_schema_version','binding_id','origin_action_id','normalized_target']);await this.binding(link,input);
  const t=this.source(input.normalized_target),row=await this.actions.readWorkspace(link),p=getPlan(row.data.plans,input.origin_action_id);
  if(p.schema_version!==2||p.period!=='day'||p.completion_mode!=='content'||!sameTarget(p.target,t))reject(422,'Source and action do not match.');
  const now=this.clock(),value={binding_id:link.binding_id,source_account_id:link.source_account_id,origin_action_id:p.id,normalized_target:t,
   planned_date_at_confirmation:p.start_date,timezone_at_confirmation:p.timezone,revision:p.revision,issued_at:now.toISOString(),expires_at:new Date(now.getTime()+7*86400000).toISOString()};
  return {origin_context:Buffer.from(canonical(value)).toString('base64url')+'.'+this.sign(value),...value};
 }
 private source(value:unknown){const t=target(value);if(!t||!['article','plan'].includes(t.kind)||canonical(t)!==canonical(value))reject(422,'Unsupported or non-normalized source.');return t!;}
 private event(link:ActionLink,value:unknown):ActionContentEvent {
  const e=object(value);keys(e,['event_id','normalized_target','confirmed_at','source_proof','origin_action_id','origin_context']);
  const id=text(e.event_id,80,true),t=this.source(e.normalized_target),stamp=text(e.confirmed_at,40,true),proof=object(e.source_proof);
  keys(proof,['version','confirmation']);
  if(!/^source-[a-f0-9]{32}$/.test(id)||!/^\d{4}-\d\d-\d\dT.*(?:Z|\+00:00)$/.test(stamp)||!Number.isFinite(Date.parse(stamp))||Date.parse(stamp)>this.clock().getTime()+120000)reject(422,'Invalid source confirmation identity or timestamp.');
  if(proof.version!==1||proof.confirmation!==(t.kind==='article'?'article_read':'lesson_completed'))reject(422,'Explicit source confirmation proof required.');
  if(e.origin_action_id!==undefined&&e.origin_action_id!==null&&(!/^action-[a-zA-Z0-9-]+$/.test(text(e.origin_action_id,80,true))))reject(422,'Invalid origin action.');
  if(new Date(stamp).toISOString().slice(0,19)!==stamp.slice(0,19))reject(422,'Invalid source calendar timestamp.');
  const event:ActionContentEvent={event_id:id,owner_id:link.userId,normalized_target:t,confirmed_at:stamp,origin_action_id:e.origin_action_id??null};
  if(event.origin_action_id){
   text(event.origin_action_id,80,true);const token=text(e.origin_context,6000,true).split('.');let context:Json;
   try{context=JSON.parse(Buffer.from(token[0],'base64url').toString());}catch{reject(422,'Invalid origin context.');}
   const expected=this.sign(context!);
   if(token.length!==2||!/^[a-f0-9]{64}$/.test(token[1])||!timingSafeEqual(Buffer.from(expected),Buffer.from(token[1])))reject(403,'Invalid origin context signature.','SOURCE_PROOF_INVALID');
   if(context!.binding_id!==link.binding_id||context!.source_account_id!==link.source_account_id||context!.origin_action_id!==event.origin_action_id||!sameTarget(context!.normalized_target,t)||Date.parse(context!.issued_at)>Date.parse(stamp)+120000||Date.parse(context!.expires_at)<Date.parse(stamp))reject(422,'Origin context does not cover this confirmation.');
   event.planned_date_at_confirmation=context!.planned_date_at_confirmation;event.timezone_at_confirmation=context!.timezone_at_confirmation;
  }else if(e.origin_context!==undefined)reject(422,'Origin context requires an action.');
  return event;
 }
 private complete(w:ActionWorkspace,event:ActionContentEvent,now:Date){
  if(event.consumed_by)return;
  const candidates=w.plans.filter(p=>p.schema_version===2&&p.period==='day'&&p.completion_mode==='content'&&p.status==='active'&&sameTarget(p.target,event.normalized_target)&&
   (event.origin_action_id?p.id===event.origin_action_id:p.start_date===businessDay(new Date(event.confirmed_at),p.timezone))).sort((a,b)=>(a.created_at+a.id).localeCompare(b.created_at+b.id));
  event.delivery_reason='COMPLETION_EVIDENCE_MISSING';
  for(const p of candidates){
   // Check the confirmation snapshot as well as the current schedule. A cached
   // context for a future/undated occurrence cannot authorize retrospective work.
   if(event.origin_action_id&&(!event.planned_date_at_confirmation||event.planned_date_at_confirmation>businessDay(new Date(event.confirmed_at),event.timezone_at_confirmation!)))continue;
   try{reconcileContent(w,p,now,event.owner_id,event.event_id);p.revision++;p.updated_at=now.toISOString();delete event.delivery_reason;return;}
   catch(error){if(!(error instanceof ApplicationError)||!['RUNNING_CONFLICT','STATE_CONFLICT','FUTURE_ACTION','UNSCHEDULED_ACTION','COMPLETION_EVIDENCE_MISSING'].includes(error.code))throw error;event.delivery_reason=error.code;}
  }
 }
 private receipt(link:ActionLink,event:ActionContentEvent,w:ActionWorkspace):Json {
  const fact=w.records.find(r=>r.source_event_id===event.event_id&&r.record_kind==='completion');
  return {accepted:true,binding_id:link.binding_id,target_user_id:link.userId,event_id:event.event_id,payload_hash:event.delivery_hash,
   status:event.consumed_by?'completed':'pending',completed_arrangements:event.consumed_by?[event.consumed_by]:[],record_id:fact?.id??null,reason:event.delivery_reason??null};
 }
 async receive(link:ActionLink,input:Json){
  keys(input,['action','action_schema_version','binding_id','event']);
  // Check the immutable inbox hash BEFORE expiring or revalidating an old proof.
  return this.actions.repository.transaction(link,async()=>{
   await this.actions.repository.lockActionOwner(link);await this.binding(link,input);
   const row=await this.actions.readWorkspace(link),w=structuredClone(row.data),id=text(object(input.event).event_id,80,true),hash=digest(input.event),old=w.content_events?.find(e=>e.event_id===id);
   if(old){if(old.delivery_hash!==hash||old.binding_id!==link.binding_id)reject(409,'Event identity was used with different content.','SOURCE_EVENT_CONFLICT',{reason:'SOURCE_EVENT_CONFLICT'});return this.receipt(link,old,w);}
   if((w.content_events?.length??0)>=10000)reject(422,'Source inbox capacity exceeded.');
   const event=this.event(link,input.event);Object.assign(event,{delivery_hash:hash,binding_id:link.binding_id});
   w.content_sources??=[];if(!w.content_sources.some(t=>sameTarget(t,event.normalized_target)))w.content_sources.push(event.normalized_target);
   (w.content_events??=[]).push(event);this.complete(w,event,this.clock());
   row.data=w;row.version++;await this.actions.repository.saveActionWorkspace(row);
   const receipt=this.receipt(link,event,w),now=this.clock().toISOString();
   await this.actions.repository.saveOperation({...link,operationId:'source:'+link.binding_id+':'+event.event_id,deviceId:'grow-source',entityType:'action_workspace',entityId:'workspace',action:'source-confirmation',payloadHash:hash,requestPayload:{},resultPayload:receipt,status:'accepted',createdAt:now,updatedAt:now});
   return receipt;
  });
 }
 async reconcile(link:ActionLink,input:Json,readOnly=false){
  keys(input,['action','action_schema_version','binding_id','event_id']);
  return this.actions.repository.transaction(link,async()=>{
   await this.actions.repository.lockActionOwner(link);await this.binding(link,input);
   const id=text(input.event_id,80,true);if(!/^source-[a-f0-9]{32}$/.test(id))reject(422,'Invalid source event identity.');
   const row=await this.actions.readWorkspace(link),w=structuredClone(row.data),event=w.content_events?.find(e=>e.event_id===id&&e.binding_id===link.binding_id);
   if(!event)reject(404,'Source event not found.');
   if(!readOnly&&!event!.consumed_by){this.complete(w,event!,this.clock());row.data=w;row.version++;await this.actions.repository.saveActionWorkspace(row);
    const op=await this.actions.repository.getOperation(link,'source:'+link.binding_id+':'+event!.event_id);
    if(!op)reject(409,'Source operation receipt is missing.');
    await this.actions.repository.saveOperation({...op!,resultPayload:this.receipt(link,event!,w),updatedAt:this.clock().toISOString()});
   }
   return this.receipt(link,event!,w);
  });
 }
}

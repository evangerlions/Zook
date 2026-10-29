import type {LightTickOwner} from '../lighttick.types.ts';
import type {LightTickRepository} from '../lighttick.repository.ts';
import type {ActionWorkspace,ActionPlan,Json} from './action.types.ts';
import {createPlans} from './action.commands.ts';
import {keys,text,reject,getPlan} from './action.validation.ts';

/** The caller holds record -> action locks for record sources, or the action lock for lessons. */
export async function createPractice(repo:LightTickRepository,owner:LightTickOwner,w:ActionWorkspace,b:Json,now:Date):Promise<Json>{
 keys(b,['key','title','source_kind','source_id','source_version','date','timezone','parent_id']);
 const kind=text(b.source_kind,20,true),id=text(b.source_id,128,true),version=text(b.source_version,80,true);
 if(!['lesson','record'].includes(kind)||!Object.hasOwn(b,'date'))reject(422,'Select a source and an explicit date or null.');
 let binding_id:string|null=null;
 if(kind==='lesson'){
  const link=await repo.getOwnerActionLink(owner),library=await repo.getLearningLibrary(owner);
  if(link?.phase!=='active')reject(409,'Connect the action workspace before creating a practice.','CONTRACT_UPGRADE_REQUIRED');
  const lesson=library?.consent_enabled&&library.binding_id===link!.binding_id&&library.lessons.find((l:Json)=>l.id===id);
  if(!lesson)reject(404,'The source lesson is unavailable or reading consent was withdrawn.');
  if(lesson.content_version!==version)reject(409,'The source changed. Keep the draft and review its current version.','REVISION_CONFLICT');
  binding_id=link!.binding_id;
 }else{
  const row=await repo.getRecord(owner,id);
  if(!row||row.payload.archived_at)reject(404,'The source record is unavailable.');
  if(String(row!.version)!==version)reject(409,'The source record changed. Preserve input and compare.','REVISION_CONFLICT');
 }
 const {plans}=createPlans(w,{key:b.key,title:b.title,period:'day',completion_mode:'check',start_date:b.date,end_date:b.date,timezone:b.timezone??'Asia/Shanghai',parent_id:b.parent_id??null},now);
 const plan=plans[0] as ActionPlan;
 // Source text/title/URL are deliberately resolved at read time, never copied into receipts.
 plan.practice_source={kind:kind as 'lesson'|'record',id,version,binding_id};plan.practice_feedback=[];
 return {plan};
}

export async function practiceSource(repo:LightTickRepository,owner:LightTickOwner,w:ActionWorkspace,id:string):Promise<Json>{
 const p=getPlan(w.plans,id),source=p.practice_source;if(!source)reject(404,'Practice source is unavailable.');
 if(source!.kind==='record'){
  const row=await repo.getRecord(owner,source!.id);
  return row?{available:true,title:'记录原文',text:row.payload.raw_text,current_version:String(row.version)}:{available:false};
 }
 const link=await repo.getOwnerActionLink(owner),library=await repo.getLearningLibrary(owner);
 const lesson=link?.binding_id===source!.binding_id&&library?.consent_enabled&&library.binding_id===link.binding_id&&library.lessons.find((l:Json)=>l.id===source!.id);
 return lesson?{available:true,title:lesson.title,text:lesson.content,current_version:lesson.content_version}:{available:false};
}

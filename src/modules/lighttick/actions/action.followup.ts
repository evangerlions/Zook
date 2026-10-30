import type {LightTickOwner} from '../lighttick.types.ts';
import type {LightTickRepository} from '../lighttick.repository.ts';
import type {ActionWorkspace,Json} from './action.types.ts';
import {getPlan,keys,text,integer,reject,activeAncestors} from './action.validation.ts';
import {createPractice,practiceSource} from './action.practice.ts';

function origin(w:ActionWorkspace,id:string,feedbackId:string){
 const p=getPlan(w.plans,id),feedback=p.practice_feedback?.find(f=>f.id===feedbackId);
 if(!p.practice_source||!feedback)reject(404,'The selected practice feedback is unavailable.');
 if(p.status==='archived')reject(409,'Archived practice history is read-only.');
 return {p,feedback:feedback!};
}
export async function followUpContext(repo:LightTickRepository,owner:LightTickOwner,w:ActionWorkspace,id:string,q:Json):Promise<Json>{
 const {p,feedback}=origin(w,id,text(q.feedback_id,80,true)),source=await practiceSource(repo,owner,w,id);
 const parents=w.plans.filter(p=>p.period!=='day'&&p.status==='active'&&activeAncestors(w.plans,p)).map(p=>Object.fromEntries(['id','title','period','revision','start_date','end_date','timezone','target_minutes'].map(k=>[k,(p as Json)[k]])));
 return {available:source.available,origin_id:p.id,feedback_id:feedback.id,revision:p.revision,feedback,source_version:source.current_version??null,source_title:source.title??null,parents};
}
/** The owner transaction holds record -> action locks before validating current source and parent. */
export async function createFollowUp(repo:LightTickRepository,owner:LightTickOwner,w:ActionWorkspace,id:string,b:Json,now:Date):Promise<Json>{
 keys(b,['key','revision','feedback_id','source_version','title','date','timezone','parent_id','parent_revision']);
 const {p,feedback}=origin(w,id,text(b.feedback_id,80,true));
 if(integer(b.revision,1,2147483647)!==p.revision)reject(409,'Practice feedback changed. Preserve input and review the latest version.','REVISION_CONFLICT');
 const source=await practiceSource(repo,owner,w,id);
 if(!source.available)reject(404,'The original practice source is no longer available.');
 if(source.current_version!==text(b.source_version,80,true))reject(409,'The source changed. Review it before confirming another practice.','REVISION_CONFLICT');
 if(b.parent_id!=null){
  const parent=getPlan(w.plans,text(b.parent_id,80,true));
  if(integer(b.parent_revision,1,2147483647)!==parent.revision)reject(409,'The selected parent changed. Review its current dates and constraints.','REVISION_CONFLICT');
  if(parent.status!=='active'||!activeAncestors(w.plans,parent))reject(409,'Choose an active parent plan.');
 }else if(b.parent_revision!=null)reject(422,'Parent revision requires a selected parent.');
 const result=await createPractice(repo,owner,w,{key:b.key,title:b.title,source_kind:p.practice_source!.kind,source_id:p.practice_source!.id,source_version:b.source_version,date:b.date,timezone:b.timezone,parent_id:b.parent_id??null},now);
 result.plan.practice_origin={plan_id:p.id,feedback_id:feedback.id};
 return result;
}

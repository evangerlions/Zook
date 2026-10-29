import type {ActionLink,Json} from './action.types.ts';
import type {ActionService} from './action.service.ts';
import {digest,integer,keys,object,reject,text} from './action.validation.ts';

function counts(value:Json):Json {
 const total=integer(value.total_lessons,0,100000),published=integer(value.published_lessons,0,total),completed=integer(value.completed_lessons,0,published);
 const raw=total?completed*100/total:0;let percent=Math.round(raw);if(raw-Math.floor(raw)===0.5&&percent%2===1)percent--;
 if(value.percent!==percent)reject(422,'Learning progress percentage does not match its source counts.');
 return {total_lessons:total,published_lessons:published,completed_lessons:completed,percent};
}
export function learningProgress(input:Json):Json {
 keys(input,['action','action_schema_version','binding_id','source_revision','observed_at','web_url','plans']);
 const source_revision=integer(input.source_revision,1,2147483647),observed_at=text(input.observed_at,80,true),web_url=text(input.web_url,1000,true);
 let url:URL;try{url=new URL(web_url);}catch{reject(422,'A configured HTTPS Grow origin is required.');}
 if(url!.username||url!.password||url!.search||url!.hash||url!.protocol!=='https:'&&!(url!.protocol==='http:'&&['localhost','127.0.0.1'].includes(url!.hostname)))reject(422,'A configured HTTPS Grow origin is required.');
 if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(observed_at)||!Number.isFinite(Date.parse(observed_at)))reject(422,'Source observation time is invalid.');
 if(!Array.isArray(input.plans)||input.plans.length>100)reject(422,'Learning progress capacity exceeded.');
 const ids=new Set<string>(),plans=input.plans.map((value:unknown)=>{
  const p=object(value);keys(p,['id','name','version','status','total_lessons','published_lessons','completed_lessons','percent','stages']);
  const id=text(p.id,80,true);if(!/^plan-[a-zA-Z0-9-]{1,70}$/.test(id)||ids.has(id)||!['active','paused','archived'].includes(p.status))reject(422,'Learning plan identity or state is invalid.');ids.add(id);
  if(!Array.isArray(p.stages)||p.stages.length>100)reject(422,'Learning stage capacity exceeded.');
  const stages=p.stages.map((value:unknown,index:number)=>{const stage=object(value);keys(stage,['number','title','total_lessons','published_lessons','completed_lessons','percent']);
   if(stage.number!==index+1)reject(422,'Stage order is invalid.');return {number:stage.number,title:text(stage.title,500,true),...counts(stage)};});
  const totals=counts(p);for(const key of ['total_lessons','published_lessons','completed_lessons'])if(stages.reduce((sum:number,s:Json)=>sum+s[key],0)!==totals[key])reject(422,'Stage totals do not match the formal plan.');
  return {id,name:text(p.name,500,true),version:integer(p.version,1,1000000),status:p.status,...totals,stages};
 });
 return {source_revision,observed_at,web_url:url!.toString(),plans};
}
export async function receiveLearningProgress(actions:ActionService,initial:ActionLink,input:Json):Promise<Json> {
 if(input.action_schema_version!==2||input.binding_id!==initial.binding_id)reject(403,'Learning progress binding does not match.');
 const value=learningProgress(input),hash=digest(value);
 if(Date.parse(value.observed_at)>actions.clock().getTime()+120000)reject(422,'Source observation is in the future.');
 return actions.repository.transaction(initial,async()=>{
  await actions.repository.lockActionOwner(initial);const link=await actions.repository.getActionLink(initial.source_account_id);
  if(!link||link.phase!=='active'||link.binding_id!==initial.binding_id||link.userId!==initial.userId)reject(409,'Learning progress requires the same active binding.');
  const row=await actions.readWorkspace(link),previous=(row.data as Json).learning_progress;
  if(previous&&(previous.source_revision>value.source_revision||previous.source_revision===value.source_revision&&previous.payload_hash!==hash))reject(409,'Source progress revision changed.','REVISION_CONFLICT');
  if(!previous||previous.source_revision<value.source_revision){(row.data as Json).learning_progress={...value,payload_hash:hash,received_at:actions.clock().toISOString()};row.version++;await actions.repository.saveActionWorkspace(row);}
  return {accepted:true,binding_id:link.binding_id,target_user_id:link.userId,source_revision:value.source_revision,payload_hash:hash};
 });
}
export function publicLearningProgress(w:Json):Json|null {
 if(!w.learning_progress)return null;const {payload_hash,...value}=w.learning_progress;return value;
}

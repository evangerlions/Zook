import {randomUUID} from 'node:crypto';
import type {ActionWorkspace,ActionPlan,Json} from './action.types.ts';
import {fields,getPlan,validateParent,dueAt,integer,text,descendants,reject,date,keys,fieldNames,sameTarget,object} from './action.validation.ts';
import {validateSource,requireUnique,duplicate,executable,makeFact,markComplete,completeFact,reconcileContent} from './action.facts.ts';

export function createPlans(w:ActionWorkspace,body:Json,now:Date):Json {
 keys(body,[...fieldNames,'key','repeat_dates']);
 const f=fields(body),dates=body.repeat_dates??[];
 if(!Array.isArray(dates)||dates.length>7)reject(422,'At most seven explicit repeat dates are supported.');
 const selected=(dates.length?dates.map(date):[f.start_date]).sort();
 if(dates.length&&(f.period!=='day'||new Set(selected).size!==selected.length||!selected.includes(f.start_date)||(Date.parse(selected.at(-1)!)-Date.parse(selected[0]!))/86400000>6))reject(422,'Repeat dates must be distinct and within seven days.');
 if(w.plans.length+selected.length>1000)reject(422,'Action capacity reached.');
 const plans=selected.map(day=>{const values=dates.length?{...f,start_date:day,end_date:day}:f;
  validateParent(w.plans,values);validateSource(w,values);requireUnique(w,values);
  const p:ActionPlan={...values,id:'action-'+randomUUID().replaceAll('-',''),schema_version:2,revision:1,status:'active',
   created_at:now.toISOString(),updated_at:now.toISOString(),reminder_at:dueAt(values),completed_at:null,completion_record_id:null};
  w.plans.push(p);return p;});
 return {plans};
}

export function schedule(w:ActionWorkspace,b:Json,now:Date):Json {
 keys(b,['title','target','date','timezone','target_minutes','estimated_minutes','key']);
 if(!Object.hasOwn(b,'date'))reject(422,'Provide an explicit date or null.');
 if(b.target_minutes!=null&&b.estimated_minutes!=null&&b.target_minutes!==b.estimated_minutes)reject(422,'Conflicting estimated minutes.');
 const input={title:b.title,period:'day',completion_mode:'content',start_date:b.date??null,end_date:b.date??null,timezone:b.timezone===undefined?'Asia/Shanghai':b.timezone,
  target:b.target,estimated_minutes:b.estimated_minutes??b.target_minutes??null};
 const f=fields(input);validateSource(w,f);const existing=duplicate(w,f);
 if(existing)return {plan:existing,existing:true};
 const result=createPlans(w,{...input,key:b.key},now);return {plan:result.plans[0],existing:false};
}

export function mutatePlan(w:ActionWorkspace,pid:string,b:Json,now:Date,ownerId:string):Json {
 keys(b,['key','revision','action','fields','variant','execution_id','outcome','actual_minutes','note','snooze_minutes','date','source_event_id','feedback']);
 const p=getPlan(w.plans,pid);
 if(integer(b.revision,1,2147483647)!==p.revision)reject(409,'The action changed in another page. Preserve input and reconcile.','REVISION_CONFLICT',{current_revision:p.revision});
 const running=w.records.find(r=>r.outcome==='running'),own=running?.plan_id===pid;
 if(p.status==='archived'||p.status==='completed'&&!['reopen','practice-feedback'].includes(b.action))reject(409,'Completed or archived actions are read-only.');
 if(own&&b.action!=='finish')reject(409,'Save the running session first.','RUNNING_CONFLICT');
 if(['start','complete-time','complete','reconcile-content'].includes(b.action)){
  if(p.status!=='active')reject(409,'Resume the action first.');if(p.period==='day')executable(w,p,now);
 }
 let execution;
 if(b.action==='edit') {
  keys(b.fields??{},fieldNames);const f=fields(b.fields);
  if(p.practice_source&&(f.period!=='day'||f.completion_mode!=='check'||f.target!==null))reject(422,'Practice completion stays independent from course completion.');
  if(p.period==='day'&&(f.start_date!==p.start_date||f.end_date!==p.end_date))reject(422,'Use reschedule to change action dates.');
  if(w.records.some(r=>r.plan_id===pid)&&['completion_mode','target','target_minutes','minimum_minutes'].some(k=>k==='target'?
   !(f.target===null&&p.target===null||sameTarget(f.target,p.target)):((f as any)[k]!==((p as any)[k]))))reject(409,'Completion configuration is locked after execution. Copy a new action.');
  validateParent(w.plans,f,p);validateSource(w,f);requireUnique(w,f,pid);Object.assign(p,f,{reminder_at:dueAt(f)});
 } else if(b.action==='practice-feedback') {
  appendPracticeFeedback(p,b.feedback,now);
 } else if(b.action==='reschedule') {
  if(p.period!=='day'||!['active','paused'].includes(p.status)||!Object.hasOwn(b,'date'))reject(422,'Select an action and an explicit date or null.');
  const day=b.date===null?null:date(b.date),f=fields({...p,start_date:day,end_date:day,...(day===null?{at:null,reminder:false}:{})});
  validateParent(w.plans,f,p);validateSource(w,f);requireUnique(w,f,pid);Object.assign(p,f,{reminder_at:dueAt(f)});
 } else if(b.action==='reopen') {
  if(p.completion_mode!=='check')reject(422,'Only check actions support reversal.');
  if(p.status!=='completed')reject(409,'The action is not completed.');
  const old=p.completion_record_id??[...w.records].reverse().find(r=>r.plan_id===pid&&r.completion_effect==='complete')?.id;
  if(!old)reject(409,'The effective completion is unavailable.');
  execution=makeFact(p,now,'reversal');execution.outcome='reopened';execution.completion_effect='reopen';execution.reverses_record_id=old;
  w.records.push(execution);p.status='active';p.completed_at=null;p.completion_record_id=null;
 } else if(['pause','resume','archive','cancel','complete'].includes(b.action)) {
  if(b.action==='resume'&&p.status!=='paused'||['pause','complete'].includes(b.action)&&p.status!=='active')reject(409,'Invalid action state.');
  if(running&&descendants(w.plans,pid).has(running.plan_id))reject(409,'Save the running descendant session first.','RUNNING_CONFLICT');
  if(b.action==='complete'&&p.period==='day'){
   if(p.completion_mode!=='check')reject(422,'Use this action completion rule.');execution=completeFact(w,p,now);
  }
  const states:Record<string,ActionPlan['status']>={pause:'paused',resume:'active',archive:'archived',cancel:'archived',complete:'completed'};
  p.status=states[b.action];
  p.reminder_at=p.status==='active'?dueAt(p):null;
 } else if(b.action==='start') {
  if(p.period!=='day'||p.completion_mode==='check')reject(422,'Check actions do not use sessions.');
  if(running)reject(409,'Another session is running.','RUNNING_CONFLICT');
  if(w.records.length>=10000)reject(422,'Execution capacity reached.');
  const variant=b.variant===undefined?'standard':b.variant;if(!['standard','minimum'].includes(variant)||variant==='minimum'&&!p.minimum_minutes)reject(422,'Invalid session variant.');
  execution=makeFact(p,now);execution.variant=variant;if(variant==='minimum')execution.planned_minutes=p.minimum_minutes;w.records.push(execution);
 } else if(b.action==='finish') {
  if(!own||!running||running.id!==b.execution_id)reject(409,'The session has ended or changed.');
  const minutes=integer(b.actual_minutes===undefined?0:b.actual_minutes,0,1440),outcome=b.outcome===undefined?'completed':b.outcome;
  if(!['completed','interrupted'].includes(outcome)||outcome==='completed'&&!minutes)reject(422,'Confirm positive minutes, or interrupt with zero.');
  const total=w.records.filter(r=>r.plan_id===pid&&r.record_kind==='session'&&r.outcome!=='running').reduce((sum,r)=>sum+r.actual_minutes,0)+minutes;
  running!.outcome=outcome==='interrupted'?'interrupted':p.completion_mode==='content'?'recorded':total>=p.target_minutes!?'completed':p.minimum_minutes&&minutes>=p.minimum_minutes?'minimum':'partial';
  Object.assign(running!,{ended_at:now.toISOString(),actual_minutes:minutes,note:text(b.note??'',2000)});execution=running;
  if(running!.outcome==='completed')markComplete(p,running!);
 } else if(b.action==='complete-time') {
  if(p.period!=='day'||p.completion_mode!=='time')reject(422,'Select a time action.');
  const minutes=w.records.filter(r=>r.plan_id===pid&&r.record_kind==='session'&&r.outcome!=='running').reduce((s,r)=>s+r.actual_minutes,0);
  if(minutes<p.target_minutes!)reject(422,'Confirmed minutes have not reached the target.');execution=completeFact(w,p,now);
 } else if(b.action==='reconcile-content') {
  if(p.completion_mode!=='content')reject(422,'Select a content action.');
  execution=reconcileContent(w,p,now,ownerId,b.source_event_id===undefined?undefined:text(b.source_event_id,160,true));
 } else if(b.action==='snooze') {
  if(p.period!=='day'||p.status!=='active'||!p.reminder||!p.reminder_at)reject(409,'No eligible reminder.');
  executable(w,p,now);p.reminder_at=new Date(Math.max(now.getTime(),Date.parse(p.reminder_at))+integer(b.snooze_minutes??15,5,120)*60000).toISOString();
 } else reject(422,'Unsupported action operation.');
 p.revision++;p.updated_at=now.toISOString();return {plan:p,...(execution?{execution}:{})};
}

function appendPracticeFeedback(p:ActionPlan,input:unknown,now:Date){
 if(!p.practice_source)reject(422,'Select a practice action.');
 const b=object(input);keys(b,['outcome','result','evidence','next_step']);
 const outcome=text(b.outcome,20,true),result=text(b.result??'',2000),evidence=text(b.evidence??'',2000),next_step=text(b.next_step??'',1000);
 if(!['applied','not_applied','unknown'].includes(outcome)||![result,evidence,next_step].some(s=>s.trim()))reject(422,'Select the actual outcome and enter a result, evidence or next step.');
 if((p.practice_feedback?.length??0)>=100)reject(422,'Practice feedback capacity reached.');
 (p.practice_feedback??=[]).push({id:'feedback-'+randomUUID().replaceAll('-',''),created_at:now.toISOString(),outcome:outcome as 'applied'|'not_applied'|'unknown',result,evidence,next_step});
}

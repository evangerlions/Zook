import {randomUUID} from 'node:crypto';
import type {ActionWorkspace,ActionPlan,ActionExecution,ActionContentEvent,Json} from './action.types.ts';
import {businessDay,activeAncestors,reject,sameTarget} from './action.validation.ts';

/** Adapt a copy on read. Never infer new source evidence or rewrite old dates. */
export function normalizeWorkspace(data:ActionWorkspace):ActionWorkspace {
 const w=structuredClone(data);
 w.plans=w.plans.map(p=>({...p,schema_version:p.schema_version??1,completion_mode:p.completion_mode??'time',
  estimated_minutes:p.estimated_minutes??null,at:p.at??null,reminder_at:p.reminder_at??null,target:p.target??null,
  completed_at:p.completed_at??null,completion_record_id:p.completion_record_id??null}));
 w.records=w.records.map(r=>({...r,schema_version:r.schema_version??1,record_kind:r.record_kind??'session',
  completion_mode:r.completion_mode??w.plans.find(p=>p.id===r.plan_id)?.completion_mode??'time',
  completion_effect:r.completion_effect??(r.outcome==='completed'?'complete':'none'),
  planned_date:Object.hasOwn(r,'planned_date')?r.planned_date:r.business_date,date_basis:r.date_basis??'legacy_planned'}));
 return w;
}

export function progress(records:ActionExecution[]):Json {
 const reversed=new Set(records.filter(r=>r.record_kind==='reversal').map(r=>r.reverses_record_id));
 return {minutes:records.filter(r=>r.record_kind==='session'&&r.outcome!=='running').reduce((s,r)=>s+r.actual_minutes,0),
  completed:new Set(records.filter(r=>r.completion_effect==='complete'&&!reversed.has(r.id)).map(r=>r.plan_id)).size,
  minimum:records.filter(r=>r.record_kind==='session'&&r.outcome==='minimum').length,
  partial:records.filter(r=>r.record_kind==='session'&&r.outcome==='partial').length,
  interrupted:records.filter(r=>r.record_kind==='session'&&r.outcome==='interrupted').length};
}

export function executable(w:ActionWorkspace,p:ActionPlan,now:Date) {
 if(!p.start_date)reject(422,'Please schedule a date first.','UNSCHEDULED_ACTION');
 if(p.start_date!>businessDay(now,p.timezone))reject(422,'Reschedule future actions before execution.','FUTURE_ACTION');
 if(!activeAncestors(w.plans,p))reject(409,'Please resume the parent plan first.','STATE_CONFLICT');
}

export function makeFact(p:ActionPlan,now:Date,kind:ActionExecution['record_kind']='session'):ActionExecution {
 return {id:'execution-'+randomUUID().replaceAll('-',''),plan_id:p.id,schema_version:2,record_kind:kind,
  completion_mode:p.completion_mode,completion_effect:'none',title:p.title,target:p.target,started_at:now.toISOString(),
  ended_at:kind==='session'?null:now.toISOString(),actual_minutes:0,note:'',variant:'standard',
  planned_minutes:p.target_minutes??p.estimated_minutes,planned_date:p.start_date,timezone:p.timezone,
  business_date:businessDay(now,p.timezone),date_basis:kind==='session'?'actual_start':'actual_confirmation',
  outcome:kind==='session'?'running':'completed'};
}

export function markComplete(p:ActionPlan,r:ActionExecution) {
 r.completion_effect='complete';p.status='completed';p.completed_at=r.ended_at;p.completion_record_id=r.id;p.reminder_at=null;
}

export function completeFact(w:ActionWorkspace,p:ActionPlan,now:Date,event?:ActionContentEvent):ActionExecution {
 const fact=makeFact(p,event?new Date(event.confirmed_at):now,'completion');
 if(event){fact.source_event_id=event.event_id;fact.recorded_at=now.toISOString();
  if(event.origin_action_id){fact.planned_date=event.planned_date_at_confirmation??null;fact.timezone=event.timezone_at_confirmation??p.timezone;
   fact.business_date=businessDay(new Date(event.confirmed_at),fact.timezone);}}
 markComplete(p,fact);w.records.push(fact);return fact;
}

export function validateSource(w:ActionWorkspace,p:Pick<ActionPlan,'target'|'completion_mode'>) {
 if(p.target&&['article','plan'].includes(p.target.kind)&&!w.content_sources?.some(t=>sameTarget(t,p.target)))
  reject(404,'The linked source is unavailable.');
}

export function duplicate(w:ActionWorkspace,p:Pick<ActionPlan,'period'|'completion_mode'|'target'|'timezone'|'start_date'>,exclude?:string) {
 if(p.period!=='day'||p.completion_mode!=='content')return;
 return w.plans.find(old=>old.id!==exclude&&old.status!=='archived'&&old.completion_mode==='content'&&old.period==='day'&&
  old.start_date===p.start_date&&old.timezone===p.timezone&&sameTarget(old.target,p.target));
}

export function requireUnique(w:ActionWorkspace,p:Pick<ActionPlan,'period'|'completion_mode'|'target'|'timezone'|'start_date'>,exclude?:string) {
 const existing=duplicate(w,p,exclude);
 if(existing)reject(409,'This source already has an arrangement on this date.','DUPLICATE_SCHEDULE',{existing_plan_id:existing.id});
}

export function reconcileContent(w:ActionWorkspace,p:ActionPlan,now:Date,ownerId:string,eventId?:string):ActionExecution {
 executable(w,p,now);
 if(w.records.some(r=>r.plan_id===p.id&&r.outcome==='running'))reject(409,'Save the running session before reconciliation.','RUNNING_CONFLICT');
 const events=(w.content_events??[]).filter(e=>e.owner_id===ownerId);
 if(eventId&&!events.some(e=>e.event_id===eventId))reject(404,'Source confirmation not found.');
 for(const event of [...events].sort((a,b)=>Date.parse(b.confirmed_at)-Date.parse(a.confirmed_at))){
  if(eventId&&event.event_id!==eventId)continue;
  const stamp=Date.parse(event.confirmed_at);
  if(!Number.isFinite(stamp)||stamp<Date.parse(p.created_at)||stamp>now.getTime()||!sameTarget(event.normalized_target,p.target))continue;
  if(event.consumed_by&&event.consumed_by!==p.id||event.origin_action_id&&event.origin_action_id!==p.id)continue;
  const confirmedDay=businessDay(new Date(stamp),p.timezone);
  if(!p.start_date||p.start_date>confirmedDay||!event.origin_action_id&&p.start_date!==confirmedDay)continue;
  const record=completeFact(w,p,now,event);event.consumed_by=p.id;return record;
 }
 reject(409,'No eligible confirmation. Open the source and confirm this occurrence.','COMPLETION_EVIDENCE_MISSING');
}

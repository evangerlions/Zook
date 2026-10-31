import { ApplicationError } from '../../../shared/errors.ts';
import type { LightTickGoalRow } from '../lighttick.types.ts';
import { dateOnly } from '../manual/manual-planning.types.ts';
import { businessDateAt } from '../lighttick-today.service.ts';

export interface ConditionRevision {
 id:string; revision:number; sequence:number; scope:'ongoing'|'temporary'; starts_on:string; ends_on:string|null;
 daily_minutes:number|null; active:boolean; reason:string; confirmed_at:string;
}
export interface DailyLimit {date:string;minutes:number|null;condition_id:string|null;condition_version:number|null}
const namespace='confirmed_planning_conditions';
function invalid(message:string):never{throw new ApplicationError(422,'LIGHTTICK_PLAN_CONSTRAINT_FAILED',message)}
function conflict(message:string):never{throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT',message)}
function valid(v:any):v is ConditionRevision {
 return v&&typeof v.id==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(v.id)&&Number.isInteger(v.revision)&&v.revision>0&&Number.isInteger(v.sequence)&&v.sequence>0&&
 ['ongoing','temporary'].includes(v.scope)&&dateOnly(v.starts_on)&&(v.scope==='ongoing'?v.ends_on===null:dateOnly(v.ends_on)&&v.ends_on>=v.starts_on&&Date.parse(v.ends_on)-Date.parse(v.starts_on)<=365*86400000)&&
 typeof v.active==='boolean'&&(v.active?Number.isInteger(v.daily_minutes)&&v.daily_minutes>0&&v.daily_minutes<=1440:v.daily_minutes===null)&&typeof v.reason==='string'&&v.reason.trim().length>0&&v.reason.length<=1000&&typeof v.confirmed_at==='string'&&Number.isFinite(Date.parse(v.confirmed_at));
}
export function conditionHistory(goal:LightTickGoalRow):ConditionRevision[]{
 const value=goal.constraints[namespace] as any;if(value===undefined)return [];
 if(!value||value.schema_version!==1||!Array.isArray(value.revisions)||value.revisions.length>512||value.revisions.some((v:any)=>!valid(v)||!Number.isFinite(Date.parse(v.confirmed_at))))conflict('Saved conditions need reconciliation before planning.');
 const versions=new Map<string,number>();let sequence=0;
 for(const v of value.revisions){if(v.sequence<=sequence||v.revision!==(versions.get(v.id)??0)+1)conflict('Saved condition history is ambiguous.');sequence=v.sequence;versions.set(v.id,v.revision)}
 return structuredClone(value.revisions);
}
export function conditionRevision(goal:LightTickGoalRow,input:Record<string,unknown>,now:string):ConditionRevision {
 const allowed=['id','condition_version','base_version','scope','starts_on','ends_on','daily_minutes','active','reason'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||!Number.isInteger(input.base_version)||!Number.isInteger(input.condition_version))invalid('Review condition fields and versions.');
 if(input.base_version!==goal.version)conflict('The goal changed; preserve input and read the current conditions.');
 if(['completed','archived'].includes(goal.status))conflict('Stopped goal history is read-only.');
 const history=conditionHistory(goal);if(history.length>=512)invalid('Condition history reached this version limit; existing history is retained.');
 const previous=history.filter(v=>v.id===input.id).sort((a,b)=>b.sequence-a.sequence)[0];
 if((previous?.revision??0)!==input.condition_version)conflict('The condition changed; review the latest revision.');
 if(previous&&previous.scope!==input.scope)invalid('A temporary condition cannot silently become ongoing.');
 if(previous&&input.active===false&&(input.starts_on!==previous.starts_on||input.ends_on!==previous.ends_on))invalid('Invalidation must retain the original applicable window.');
 if(!previous&&input.active===false)invalid('Select an existing condition before invalidating it.');
 if(previous?.scope==='ongoing'&&history.filter(v=>v.scope==='ongoing').sort((a,b)=>b.sequence-a.sequence)[0]?.id!==previous.id)conflict('An ongoing condition superseded this record; correct the current condition instead.');
 const row={id:input.id,revision:(previous?.revision??0)+1,sequence:goal.version+1,scope:input.scope,starts_on:input.starts_on,ends_on:input.ends_on,daily_minutes:input.daily_minutes,active:input.active,reason:input.reason,confirmed_at:now};
 if(!valid(row))invalid('Confirm a valid date window, daily minutes (1–1440), and reason.');
 return row as ConditionRevision;
}
export function conditionsValue(goal:LightTickGoalRow,row:ConditionRevision){return {schema_version:1,revisions:[...conditionHistory(goal),row]}}
export function effectiveDailyLimits(goal:LightTickGoalRow,start:string,end:string):DailyLimit[]{
 if(!dateOnly(start)||!dateOnly(end)||end<start||Date.parse(end)-Date.parse(start)>30*86400000)invalid('Review a valid planning window of at most 31 days.');
 const history=conditionHistory(goal),latest=new Map<string,ConditionRevision>();
 for(const v of history)if(!latest.has(v.id)||latest.get(v.id)!.sequence<v.sequence)latest.set(v.id,v);
 const revisions=[...latest.values()].sort((a,b)=>b.sequence-a.sequence),days:DailyLimit[]=[];
 for(let time=Date.parse(start);time<=Date.parse(end);time+=86400000){
  const date=new Date(time).toISOString().slice(0,10),ongoing=revisions.find(v=>v.scope==='ongoing'&&v.starts_on<=date),temporary=revisions.find(v=>v.scope==='temporary'&&v.starts_on<=date&&v.ends_on!>=date);
  const chosen=temporary?.active?temporary:ongoing;
  days.push({date,minutes:chosen?.active?chosen.daily_minutes:null,condition_id:chosen?.id??null,condition_version:chosen?.revision??null});
 }
 return days;
}
interface CapacityTask {id:string;goalId:string;status:string;scheduledFor?:string;estimatedMinutes:number|null;actualMinutes?:number}
export function assertDailyCapacity(goal:LightTickGoalRow,start:string,end:string,actions:{scheduled_for:string|null;estimated_minutes:number|null}[],existing:CapacityTask[],retired:Set<string>,timezone:string){
 const limits=effectiveDailyLimits(goal,start,end).map(v=>({...v,known_minutes:0,unknown_count:0})),byDate=new Map(limits.map(v=>[v.date,v]));
 const add=(date:string|null,minutes:number|null)=>{const day=date?byDate.get(date):undefined;if(!day)return;if(minutes===null)day.unknown_count++;else day.known_minutes+=minutes};
 for(const t of existing)if(t.goalId===goal.id&&(!retired.has(t.id)||t.status==='completed')&&['pending','in_progress','completed'].includes(t.status)&&t.scheduledFor){const date=dateOnly(t.scheduledFor)?t.scheduledFor:businessDateAt(new Date(t.scheduledFor),timezone);add(date,t.status==='completed'&&t.actualMinutes!==undefined?t.actualMinutes:t.estimatedMinutes)}
 for(const a of actions)add(a.scheduled_for,a.estimated_minutes);
 if(limits.some(v=>v.minutes!==null&&v.known_minutes>v.minutes))invalid('Known existing and proposed work exceeds the confirmed daily capacity. Review rescheduling, splitting or reducing work explicitly.');
 return limits;
}
/** Public goal PATCH cannot manufacture or erase confirmed audit history. */
export function assertConditionNamespaceUnchanged(previous:Record<string,unknown>,next:Record<string,unknown>){
 if(JSON.stringify(previous[namespace])!==JSON.stringify(next[namespace]))invalid('Confirmed conditions must use their reviewed versioned command.');
}

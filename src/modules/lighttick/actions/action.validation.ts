import {createHash} from 'node:crypto';
import {ApplicationError} from '../../../shared/errors.ts';
import type {ActionFields,ActionPlan,ActionTarget,Json} from './action.types.ts';
import type {ErrorCode} from '../../../shared/types.ts';
export const reject=(status:number,message:string,code:ErrorCode=status===404?'LIGHTTICK_RESOURCE_NOT_FOUND':status===409?'STATE_CONFLICT':'VALIDATION_ERROR',details?:unknown):never=>{throw new ApplicationError(status,code,message,details);};
export function canonical(value:any):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const digest=(value:any)=>createHash('sha256').update(canonical(value)).digest('hex');
export function object(value:unknown):Json {if(!value||typeof value!=='object'||Array.isArray(value))reject(422,'请求内容无效。');return value as Json;}
export function text(value:unknown,max:number,required=false):string {
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))reject(422,'请检查文本内容与长度。');return value as string;
}
export function integer(value:unknown,min:number,max:number):number {if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)reject(422,'数值超出允许范围。');return Number(value);}
export function date(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)reject(422,'日期无效。');return value as string;
}
export function businessDay(now:Date,zone:string):string {const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
export function localParts(now:Date,zone:string):Json {return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));}
export function dueAt(f:ActionFields):string|null {
 if(!f.start_date||!f.at)return null;
 const desired=Date.parse(f.start_date+'T'+f.at+':00Z');let utc=desired;
 for(let i=0;i<4;i++){const p=localParts(new Date(utc),f.timezone);utc+=desired-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);}
 const result=new Date(utc),p=localParts(result,f.timezone);
 if(`${p.year}-${p.month}-${p.day}`!==f.start_date||`${p.hour}:${p.minute}`!==f.at)reject(422,'Invalid daylight-saving local time.');
 return result.toISOString();
}
export const fieldNames=['title','period','horizon','start_date','end_date','timezone','parent_id','target_minutes','minimum_minutes','estimated_minutes','target_count','at','reminder','reason','if_then','target','completion_mode'];
export function keys(value:Json,allowed:string[]) {if(Object.keys(value).some(k=>!allowed.includes(k)))reject(422,'Unknown action field.');}
export function target(value:unknown):ActionTarget|null {
 if(value===null||value===undefined)return null;
 const t=object(value),kind=text(t.kind,20,true);keys(t,['kind','course','plan_id','lesson_no']);
 if(['library','book'].includes(kind))return {kind};
 if(kind==='article'){const course=text(t.course,500,true);if(!/^article-[a-zA-Z0-9-]{1,100}$/.test(course))reject(422,'Invalid article reference.');return {kind,course};}
 if(kind==='plan'){const plan_id=text(t.plan_id,80,true);if(!/^plan-[a-zA-Z0-9-]{1,70}$/.test(plan_id))reject(422,'Invalid plan reference.');return {kind,plan_id,lesson_no:integer(t.lesson_no,1,100000)};}
 if(kind==='renzhi')return {kind,lesson_no:integer(t.lesson_no,1,100000)};
 if(['yingyu','biaoda'].includes(kind)){const course=text(t.course,500,true);if(/[\\\x00-\x1f]/.test(course)||course.split('/').some(p=>['','.','..'].includes(p)))reject(422,'Invalid course reference.');return {kind,course};}
 reject(422,'Unsupported source kind.');
}
export const sameTarget=(a:ActionTarget|null,b:ActionTarget|null)=>!!a&&!!b&&canonical(target(a))===canonical(target(b));
export const levels={year:0,month:1,week:2,day:3};
export function fields(value:unknown):ActionFields {
 const v=object(value),period=v.period,mode=v.completion_mode===undefined?'time':v.completion_mode;
 if(!Object.hasOwn(levels,period)||!['time','content','check'].includes(mode))reject(422,'Invalid period or completion mode.');
 for(const key of ['target_minutes','minimum_minutes','estimated_minutes'])if(v[key]!=null)integer(v[key],1,1440);
 const source=target(v.target);
 const f:ActionFields={title:text(v.title,160,true).trim(),period,horizon:v.horizon??(period==='year'?'long':'short'),
  start_date:v.start_date==null?null:date(v.start_date),end_date:v.end_date==null?null:date(v.end_date),timezone:text(v.timezone===undefined?'Asia/Shanghai':v.timezone,80,true),parent_id:v.parent_id??null,
  target_minutes:mode==='time'?integer(v.target_minutes===undefined?20:v.target_minutes,1,1440):null,
  minimum_minutes:null,estimated_minutes:mode==='time'||v.estimated_minutes==null?null:integer(v.estimated_minutes,1,1440),
  target_count:integer(v.target_count===undefined?1:v.target_count,1,1000),at:v.at??null,reminder:v.reminder===undefined?false:v.reminder,reason:text(v.reason===undefined?'':v.reason,1000),if_then:text(v.if_then===undefined?'':v.if_then,1000),
  target:mode==='check'?null:source,completion_mode:mode};
 if(mode==='time')f.minimum_minutes=v.minimum_minutes===undefined?Math.min(5,f.target_minutes!):v.minimum_minutes===null?null:integer(v.minimum_minutes,1,f.target_minutes!);
 if(!['short','long'].includes(f.horizon)||typeof f.reminder!=='boolean'||f.at!==null&&(typeof f.at!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.at)))reject(422,'Invalid action time or classification.');
 try{new Intl.DateTimeFormat('en',{timeZone:f.timezone});}catch{reject(422,'Invalid timezone.');}
 if((f.start_date===null)!==(f.end_date===null)||f.start_date===null&&(period!=='day'||f.at!==null||f.parent_id!==null)||f.reminder&&(!f.start_date||!f.at))reject(422,'Date, parent or reminder requires an explicit schedule.');
 if(f.start_date&&f.end_date&&(f.end_date<f.start_date||(Date.parse(f.end_date)-Date.parse(f.start_date))/86400000>366))reject(422,'Invalid date range.');
 if(period==='day'&&(f.start_date!==f.end_date||f.target_count!==1)||period!=='day'&&mode!=='time'||period==='week'&&(Date.parse(f.end_date!)-Date.parse(f.start_date!))/86400000>6||period==='month'&&f.start_date!.slice(0,7)!==f.end_date!.slice(0,7)||period==='year'&&f.start_date!.slice(0,4)!==f.end_date!.slice(0,4))reject(422,'Invalid date range for selected period.');
 if(mode==='content'&&(!f.target||!['article','plan'].includes(f.target.kind)))reject(422,'Content requires a supported article or plan lesson.');
 if(f.parent_id!==null)text(f.parent_id,80,true);
 dueAt(f);return f;
}
export function getPlan(plans:ActionPlan[],id:string):ActionPlan {const p=plans.find(p=>p.id===id);if(!p)reject(404,'行动计划不存在。');return p!;}
export function descendants(plans:ActionPlan[],id:string):Set<string>{const ids=new Set([id]);for(let i=0;i<4;i++)for(const p of plans)if(p.parent_id&&ids.has(p.parent_id))ids.add(p.id);return ids;}
export function validateParent(plans:ActionPlan[],f:ActionFields,existing?:ActionPlan) {
 if(f.parent_id){const p=getPlan(plans,f.parent_id);if(levels[p.period]>=levels[f.period]||p.status==='archived'||!f.start_date||!f.end_date||p.start_date!>f.start_date||p.end_date!<f.end_date||p.timezone!==f.timezone)reject(422,'上级计划的周期、日期或时区不相容。');}
 if(existing&&(f.period!==existing.period||plans.some(p=>p.parent_id===existing.id&&(!f.start_date||!f.end_date||!p.start_date||!p.end_date||f.start_date>p.start_date||f.end_date<p.end_date||f.timezone!==p.timezone))))reject(422,'请先处理已有下级计划，再调整周期或日期。');
}
export function activeAncestors(plans:ActionPlan[],p:ActionPlan):boolean {
 for(let i=0;p.parent_id&&i<4;i++){p=getPlan(plans,p.parent_id);if(p.status!=='active')return false;}return true;
}

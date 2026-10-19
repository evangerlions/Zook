import {createHash} from 'node:crypto';
import {ApplicationError} from '../../../shared/errors.ts';
import type {ActionFields,ActionPlan,Json} from './action.types.ts';
export const reject=(status:number,message:string):never=>{throw new ApplicationError(status,status===404?'LIGHTTICK_RESOURCE_NOT_FOUND':status===409?'LIGHTTICK_VERSION_CONFLICT':'REQ_FIELD_INVALID',message);};
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
export function dueAt(f:ActionFields):string {
 const desired=Date.parse(f.start_date+'T'+f.at+':00Z');let utc=desired;
 for(let i=0;i<4;i++){const p=localParts(new Date(utc),f.timezone);const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);utc+=desired-represented;}
 const result=new Date(utc),p=localParts(result,f.timezone);
 if(`${p.year}-${p.month}-${p.day}`!==f.start_date||`${p.hour}:${p.minute}`!==f.at)reject(422,'这个时间处于夏令时跳变中，请选择其他时间。');
 return result.toISOString();
}
export const levels={year:0,month:1,week:2,day:3};
export function fields(value:unknown):ActionFields {
 const v=object(value),period=v.period;
 if(!Object.hasOwn(levels,period))reject(422,'计划周期无效。');
 const f:ActionFields={title:text(v.title,160,true).trim(),period,horizon:v.horizon??(period==='year'?'long':'short'),
  start_date:date(v.start_date),end_date:date(v.end_date),timezone:text(v.timezone??'Asia/Shanghai',80,true),parent_id:v.parent_id??null,
  target_minutes:integer(v.target_minutes??20,1,1440),minimum_minutes:integer(v.minimum_minutes??5,1,1440),target_count:integer(v.target_count??1,1,1000),
  at:v.at??'21:00',reminder:v.reminder??false,reason:text(v.reason??'',1000),if_then:text(v.if_then??'',1000),
  target:{kind:'library',course:'',plan_id:'',lesson_no:1,...object(v.target??{})}};
 if(!['short','long'].includes(f.horizon)||typeof f.reminder!=='boolean'||typeof f.at!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.at))reject(422,'计划分类、时间或提醒无效。');
 try{new Intl.DateTimeFormat('en',{timeZone:f.timezone});}catch{reject(422,'时区无效。');}
 if(f.end_date<f.start_date||(Date.parse(f.end_date)-Date.parse(f.start_date))/86400000>366||f.minimum_minutes>f.target_minutes)reject(422,'日期范围或标准／起步时长无效。');
 if(period==='day'&&(f.start_date!==f.end_date||f.target_count!==1)||period==='week'&&(Date.parse(f.end_date)-Date.parse(f.start_date))/86400000>6||period==='month'&&f.start_date.slice(0,7)!==f.end_date.slice(0,7)||period==='year'&&f.start_date.slice(0,4)!==f.end_date.slice(0,4))reject(422,'日期不在所选计划周期内。');
 if(f.parent_id!==null)text(f.parent_id,80,true);
 const t=f.target;text(t.course,500);text(t.plan_id,80);integer(t.lesson_no,1,100000);
 if(!['library','book','renzhi','yingyu','biaoda','plan','article'].includes(t.kind)||/[\x00-\x1f]/.test(t.course))reject(422,'学习内容类型无效。');
 if(['yingyu','biaoda'].includes(t.kind)&&(!t.course||t.course.includes('\\')||t.course.split('/').some(p=>['','.','..'].includes(p))))reject(422,'课程标识无效。');
 if(t.kind==='article'&&!/^article-[a-zA-Z0-9-]{1,100}$/.test(t.course)||t.kind==='plan'&&!/^plan-[a-zA-Z0-9-]{1,70}$/.test(t.plan_id))reject(422,'学习内容标识无效。');
 dueAt(f);return f;
}
export function getPlan(plans:ActionPlan[],id:string):ActionPlan {const p=plans.find(p=>p.id===id);if(!p)reject(404,'行动计划不存在。');return p!;}
export function descendants(plans:ActionPlan[],id:string):Set<string>{const ids=new Set([id]);for(let i=0;i<4;i++)for(const p of plans)if(p.parent_id&&ids.has(p.parent_id))ids.add(p.id);return ids;}
export function validateParent(plans:ActionPlan[],f:ActionFields,existing?:ActionPlan) {
 if(f.parent_id){const p=getPlan(plans,f.parent_id);if(levels[p.period]>=levels[f.period]||p.status==='archived'||p.start_date>f.start_date||p.end_date<f.end_date||p.timezone!==f.timezone)reject(422,'上级计划的周期、日期或时区不相容。');}
 if(existing&&(f.period!==existing.period||plans.some(p=>p.parent_id===existing.id&&(f.start_date>p.start_date||f.end_date<p.end_date||f.timezone!==p.timezone))))reject(422,'请先处理已有下级计划，再调整周期或日期。');
}
export function activeAncestors(plans:ActionPlan[],p:ActionPlan):boolean {
 for(let i=0;p.parent_id&&i<4;i++){p=getPlan(plans,p.parent_id);if(p.status!=='active')return false;}return true;
}

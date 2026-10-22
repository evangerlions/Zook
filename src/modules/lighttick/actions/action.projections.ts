import type {ActionWorkspace,Json} from './action.types.ts';
import {activeAncestors,descendants,getPlan,date,text,reject} from './action.validation.ts';
export function summary(records:Json[]):Json {return {minutes:records.filter(r=>r.outcome!=='running').reduce((s,r)=>s+r.actual_minutes,0),
 completed:records.filter(r=>r.outcome==='completed').length,minimum:records.filter(r=>['minimum','partial'].includes(r.outcome)).length,interrupted:records.filter(r=>r.outcome==='interrupted').length};}
export function listing(w:ActionWorkspace,now:Date,version:number):Json {
 return {plans:w.plans.map(p=>{const ids=descendants(w.plans,p.id);return {...p,blocked:!activeAncestors(w.plans,p),progress:summary(w.records.filter(r=>ids.has(r.plan_id)))};}).sort((a,b)=>(a.start_date+a.at+a.id).localeCompare(b.start_date+b.at+b.id)),
  execution:w.records.find(r=>r.outcome==='running')??null,server_time:now.toISOString(),workspace_version:version,reminder_delivery:'native-foreground-and-calendar'};
}
export function reviewContext(w:ActionWorkspace,b:Json):Json {
 const p=getPlan(w.plans,text(b.plan_id,80,true)),begin=date(b.start_date),end=date(b.end_date);
 if(begin<p.start_date||end>p.end_date||end<begin)reject(422,'复盘日期需位于所选计划范围内。');
 const ids=descendants(w.plans,p.id),records=w.records.filter(r=>ids.has(r.plan_id)&&r.business_date>=begin&&r.business_date<=end).sort((a,b)=>(b.started_at+b.id).localeCompare(a.started_at+a.id));
 const days=w.plans.filter(p=>ids.has(p.id)&&p.period==='day'&&p.start_date>=begin&&p.start_date<=end),done=new Set(records.filter(r=>r.outcome==='completed').map(r=>r.plan_id));
 const facts:Json={plan:Object.fromEntries(['id','title','period','horizon','start_date','end_date','target_count','target_minutes','minimum_minutes','reason','if_then','timezone'].map(k=>[k,(p as any)[k]])),
  start_date:begin,end_date:end,stats:{...summary(records),planned_days:days.length,completed_days:days.filter(p=>done.has(p.id)).length,running:records.filter(r=>r.outcome==='running').length},
  records:records.slice(0,30).map(r=>({...Object.fromEntries(['id','title','business_date','timezone','actual_minutes','outcome'].map(k=>[k,(r as any)[k]])),...(b.include_notes?{note:r.note.length>300?r.note.slice(0,300)+'（已截取）':r.note}:{})})),records_truncated:records.length>30};
 if(b.include_review)facts.reviews=w.reviews.filter(r=>r.plan_id===p.id&&r.start_date>=begin&&r.end_date<=end).sort((a,b)=>(b.created_at+b.id).localeCompare(a.created_at+a.id)).slice(0,5).map(r=>Object.fromEntries(['id','created_at','start_date','end_date','worked','obstacles','next_action'].map(k=>[k,typeof r[k]==='string'&&r[k].length>400?r[k].slice(0,400)+'（已截取）':r[k]])));
 return facts;
}
export function calendar(w:ActionWorkspace,pid:string,now:Date):string {
 const p=getPlan(w.plans,pid);if(p.period!=='day'||p.status!=='active'||!activeAncestors(w.plans,p))reject(409,'请选择待执行的日行动导出日历。');
 const stamp=(d:Date)=>d.toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
 const escape=(s:string)=>s.replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll('\r','').replaceAll(';','\\;').replaceAll(',','\\,');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//LightTick//Action Plans//ZH','BEGIN:VEVENT','UID:'+pid+'@grow','DTSTAMP:'+stamp(now),
 'DTSTART:'+stamp(new Date(p.reminder_at)),'DTEND:'+stamp(new Date(Date.parse(p.reminder_at)+p.target_minutes*60000)),'SUMMARY:'+escape(p.title),'DESCRIPTION:'+escape('打开知行成长或 LightTick 继续行动。'+p.if_then)];
 if(p.reminder)lines.push('BEGIN:VALARM','TRIGGER:PT0S','ACTION:DISPLAY','DESCRIPTION:行动计划提醒','END:VALARM');lines.push('END:VEVENT','END:VCALENDAR');
 return lines.flatMap(line=>{const parts=[];let current='';for(const char of line){if(Buffer.byteLength(current+char)>74){parts.push(current);current=' ';}current+=char;}parts.push(current);return parts;}).join('\r\n')+'\r\n';
}

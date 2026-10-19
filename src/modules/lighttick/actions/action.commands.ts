import {randomUUID} from 'node:crypto';
import type {ActionWorkspace,ActionPlan,Json} from './action.types.ts';
import {fields,getPlan,validateParent,dueAt,businessDay,integer,text,descendants,activeAncestors,reject,date} from './action.validation.ts';
export function createPlans(w:ActionWorkspace,body:Json,now:Date):Json {
 const f=fields(body),dates=body.repeat_dates??[f.start_date];
 if(!Array.isArray(dates)||dates.length>7)reject(422,'重复行动最多七天。');
 const selected=(dates.length?dates:[f.start_date]).map(date).sort();
 if(Array.isArray(body.repeat_dates)&&body.repeat_dates.length&&(f.period!=='day'||new Set(selected).size!==selected.length||!selected.includes(f.start_date)||(Date.parse(selected.at(-1)!)-Date.parse(selected[0]))/86400000>6))reject(422,'请选择七天内不重复的行动日期。');
 if(w.plans.length+selected.length>1000)reject(422,'计划数量已达首版上限。');
 const plans=selected.map(day=>{const values=selected.length>1?{...f,start_date:day,end_date:day}:f;validateParent(w.plans,values);
  const p:ActionPlan={...values,id:'action-'+randomUUID().replaceAll('-',''),revision:1,status:'active',created_at:now.toISOString(),updated_at:now.toISOString(),reminder_at:dueAt(values)};w.plans.push(p);return p;});
 return {plans};
}
export function mutatePlan(w:ActionWorkspace,pid:string,b:Json,now:Date):Json {
 const p=getPlan(w.plans,pid);if(integer(b.revision,1,2147483647)!==p.revision)reject(409,'另一页面已更新计划，请刷新核对；你的输入仍保留。');
 const running=w.records.find(r=>r.outcome==='running'),own=running?.plan_id===pid;
 if(['edit','pause','archive'].includes(b.action)&&own)reject(409,'请先记录完成或中断，再调整计划。');
 let execution;
 if(b.action==='edit') {if(p.status==='archived')reject(409,'已归档计划不可修改。');const f=fields(b.fields);validateParent(w.plans,f,p);Object.assign(p,f,{reminder_at:dueAt(f)});}
 else if(['pause','resume','archive','complete'].includes(b.action)) {
  if(p.status==='archived'||b.action==='resume'&&p.status!=='paused'||['pause','complete'].includes(b.action)&&p.status!=='active')reject(409,'这个计划当前无法进行该操作。');
  if(b.action==='complete'&&p.period==='day')reject(422,'日行动请开始执行后确认实际完成情况。');
  if(running&&descendants(w.plans,pid).has(running.plan_id))reject(409,'请先结束子计划正在进行的执行。');
  p.status=({pause:'paused',resume:'active',archive:'archived',complete:'completed'} as const)[b.action as 'pause'];
 } else if(b.action==='start') {
  if(p.period!=='day'||p.status!=='active'||!activeAncestors(w.plans,p))reject(409,'请选择有效的待执行日行动，并确认上级计划处于推进中。');
  if(p.start_date>businessDay(now,p.timezone))reject(422,'未来日行动尚未开始，请先调整日期。');
  if(running)reject(409,'已有一项执行正在进行，请先记录完成或中断。');
  if(w.records.length>=10000)reject(422,'执行记录已达首版容量上限，请先导出并联系管理员扩容。');
  const variant=b.variant??'standard';if(!['standard','minimum'].includes(variant))reject(422,'执行方案无效。');
  execution={id:'execution-'+randomUUID().replaceAll('-',''),plan_id:pid,title:p.title,started_at:now.toISOString(),ended_at:null,
   variant,planned_minutes:variant==='minimum'?p.minimum_minutes:p.target_minutes,actual_minutes:0,outcome:'running' as const,note:'',business_date:p.start_date,timezone:p.timezone,target:p.target};
  w.records.push(execution);
 } else if(b.action==='finish') {
  if(!own||!running||running.id!==b.execution_id)reject(409,'该次执行已结束或发生变化，请刷新记录。');
  const minutes=integer(b.actual_minutes??0,0,1440),outcome=b.outcome??'completed';
  if(!['completed','interrupted'].includes(outcome)||outcome==='completed'&&!minutes)reject(422,'请填写实际分钟，未执行可选择中断保存。');
  running!.outcome=outcome==='interrupted'?'interrupted':minutes>=p.target_minutes?'completed':minutes>=p.minimum_minutes?'minimum':'partial';
  Object.assign(running!,{ended_at:now.toISOString(),actual_minutes:minutes,note:text(b.note??'',2000)});execution=running;
  if(running!.outcome==='completed')p.status='completed';
 } else if(b.action==='snooze') {
  if(p.period!=='day'||p.status!=='active'||!p.reminder||!activeAncestors(w.plans,p))reject(409,'当前计划没有待处理的提醒。');
  p.reminder_at=new Date(Math.max(now.getTime(),Date.parse(p.reminder_at))+integer(b.snooze_minutes??15,5,120)*60000).toISOString();
 } else reject(422,'操作类型无效。');
 p.revision++;p.updated_at=now.toISOString();return {plan:p,...(execution?{execution}:{})};
}

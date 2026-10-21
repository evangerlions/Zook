/** Private, trusted Grow export graph. No public command accepts this inventory. */
import type {ActionWorkspace,ActionPlan,ActionContentEvent,Json} from './action.types.ts';
import {normalizeWorkspace} from './action.facts.ts';
import {object,text,integer,date,fields,fieldNames,digest,canonical,target,sameTarget,levels,businessDay,reject} from './action.validation.ts';
export const snapshotCollections=['plans','records','reviews','reports','operations','claims','content_sources','content_events'] as const;
const limits=[1000,10000,2000,1000,20000,20000,2000,10000];
export const snapshotCounts=(s:Json)=>Object.fromEntries(snapshotCollections.map(k=>[k,s[k].length]));
const stamp=(v:unknown)=>{const s=text(v,80,true);date(s.slice(0,10));if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(s)||!Number.isFinite(Date.parse(s)))reject(422,'快照时间无效。');return s;};
const id=(v:unknown,prefix:string)=>{const s=text(v,160,true);if(!new RegExp('^'+prefix+'-[a-zA-Z0-9-]+$').test(s))reject(422,'快照对象编号无效。');return s;};
const hash=(v:unknown)=>{if(typeof v!=='string'||!(/^[a-f0-9]{64}$/).test(v))reject(422,'快照摘要无效。');return v;};
function unique(rows:Json[],key:string){const seen=new Set<string>();for(const row of rows){object(row);const value=text(row[key],160,true);if(seen.has(value))reject(422,'快照含重复对象或请求编号。');seen.add(value);}}
function plan(v:Json){
 id(v.id,'action');if(v.schema_version!==undefined&&v.schema_version!==1&&v.schema_version!==2)reject(422,'快照行动版本无效。');
 const f=fields(v);integer(v.revision,1,2147483647);stamp(v.created_at);stamp(v.updated_at);
 if(Date.parse(v.updated_at)<Date.parse(v.created_at)||!['active','paused','completed','archived'].includes(v.status))reject(422,'快照行动状态无效。');
 if(v.reminder_at!=null)stamp(v.reminder_at);
 if(v.schema_version===2){
  for(const key of fieldNames)if(key==='target'?!sameNullableTarget(v[key],f.target):canonical(v[key])!==canonical((f as Json)[key]))reject(422,'快照条件字段无效：'+key);
  if(v.completed_at!==null)stamp(v.completed_at);
  if(v.completion_record_id!==null)id(v.completion_record_id,'execution');
 }
}
function records(w:ActionWorkspace){
 const known=new Map(w.plans.map(p=>[p.id,p]));
 for(const r of w.records){
  const p=known.get(r.plan_id);if(!p)reject(422,'执行记录关联的行动不存在。');
  id(r.id,'execution');stamp(r.started_at);if(r.ended_at!==null)stamp(r.ended_at);
  date(r.business_date);integer(r.actual_minutes,0,1440);text(r.title,160,true);text(r.note??'',2000);
  try{new Intl.DateTimeFormat('en',{timeZone:text(r.timezone,80,true)});}catch{reject(422,'执行时区无效。');}
  if(!['standard','minimum'].includes(r.variant)||r.planned_minutes!==null&&r.planned_minutes!==undefined&&(!Number.isInteger(r.planned_minutes)||r.planned_minutes<1||r.planned_minutes>1440))reject(422,'执行投入无效。');
  if(r.schema_version!==1&&r.schema_version!==2||!['running','completed','minimum','partial','interrupted','recorded','reopened'].includes(r.outcome))reject(422,'执行版本或结果无效。');
  if((r.outcome==='running')!==(r.ended_at===null)||r.ended_at&&Date.parse(r.ended_at)<Date.parse(r.started_at))reject(422,'执行起止状态无效。');
  if(r.schema_version!==2)continue; // Preserve ended legacy facts exactly, without reinterpreting them.
  if(r.completion_mode!==p!.completion_mode||!sameNullableTarget(r.target,p!.target)||!['session','completion','reversal'].includes(r.record_kind)||!['none','complete','reopen'].includes(r.completion_effect))reject(422,'执行模式或事实无效。');
  date(r.planned_date);
  if(r.date_basis!==(r.record_kind==='session'?'actual_start':'actual_confirmation')||r.business_date!==businessDay(new Date(r.started_at),r.timezone))reject(422,'执行发生日期无效。');
  if(r.record_kind==='session'){
   if(r.completion_mode==='check'||r.completion_effect==='reopen'||r.outcome==='reopened'||r.completion_mode==='content'&&r.completion_effect!=='none'||r.outcome==='running'&&(r.actual_minutes!==0||r.completion_effect!=='none'||p!.status!=='active'))reject(422,'会话事实无效。');
   if(r.completion_effect==='complete'&&r.outcome!=='completed'||r.outcome==='completed'&&r.completion_effect!=='complete')reject(422,'会话完成效果无效。');
  }else if(r.actual_minutes!==0||r.started_at!==r.ended_at||r.record_kind==='completion'&&(r.outcome!=='completed'||r.completion_effect!=='complete')||r.record_kind==='reversal'&&(r.completion_mode!=='check'||r.outcome!=='reopened'||r.completion_effect!=='reopen'))reject(422,'瞬时完成或撤销事实无效。');
  if(r.record_kind!=='reversal'&&r.reverses_record_id||r.record_kind!=='completion'&&r.source_event_id)reject(422,'事实引用无效。');
 }
 if(w.records.filter(r=>r.outcome==='running').length>1)reject(409,'接管后存在多个运行会话。','RUNNING_CONFLICT');
 const reversed=new Set<string>();
 for(const r of w.records.filter(r=>r.record_kind==='reversal')){
  const original=w.records.find(v=>v.id===r.reverses_record_id);
  if(!original||original.plan_id!==r.plan_id||original.completion_mode!=='check'||original.completion_effect!=='complete'||Date.parse(original.ended_at!)>Date.parse(r.started_at)||reversed.has(original.id))reject(422,'撤销事实未指向唯一合法完成。');
  reversed.add(original!.id);
 }
 for(const p of w.plans.filter(p=>p.schema_version===2&&p.period==='day')){
  const active=w.records.filter(r=>r.plan_id===p.id&&r.completion_effect==='complete'&&!reversed.has(r.id));
  if(active.length>1||(p.status==='completed')!==(active.length===1)||active.length===1&&(p.completion_record_id!==active[0].id||p.completed_at!==active[0].ended_at)||!active.length&&(p.completion_record_id!==null||p.completed_at!==null))reject(422,'行动状态与有效完成指针不一致。');
  if(active.length&&p.completion_mode==='time'&&w.records.filter(r=>r.plan_id===p.id&&r.record_kind==='session'&&r.ended_at).reduce((n,r)=>n+r.actual_minutes,0)<p.target_minutes!)reject(422,'计时完成缺少足够的已确认投入。');
 }
}
const sameNullableTarget=(a:unknown,b:unknown)=>a==null&&b==null||sameTarget(target(a),target(b));
function events(w:ActionWorkspace){
 for(const e of w.content_events??[]){
  if(!/^source-[a-f0-9]{32}$/.test(e.event_id))reject(422,'来源事件编号无效。');
  stamp(e.confirmed_at);const t=target(e.normalized_target);
  if(!t||!['article','plan'].includes(t.kind)||canonical(t)!==canonical(e.normalized_target)||!w.content_sources?.some(v=>sameTarget(v,t)))reject(422,'来源事件缺少来源清单。');
  const p=w.plans.find(p=>p.id===(e.origin_action_id??e.consumed_by));
  if(e.origin_action_id&&(!p||p.completion_mode!=='content'||!sameTarget(p.target,t)))reject(422,'来源上下文不匹配。');
  if(e.origin_action_id){if(e.planned_date_at_confirmation!==null)date(e.planned_date_at_confirmation);try{new Intl.DateTimeFormat('en',{timeZone:text(e.timezone_at_confirmation,80,true)});}catch{reject(422,'来源快照时区无效。');}}
  const facts=w.records.filter(r=>r.source_event_id===e.event_id);
  if(e.consumed_by){
   const p=w.plans.find(p=>p.id===e.consumed_by),r=facts[0];
   if(!p||p.completion_mode!=='content'||facts.length!==1||r.plan_id!==p.id||r.record_kind!=='completion'||r.completion_effect!=='complete'||r.started_at!==e.confirmed_at||e.origin_action_id&&(e.planned_date_at_confirmation!==r.planned_date||e.timezone_at_confirmation!==r.timezone)||!sameTarget(p.target,t)||Date.parse(e.confirmed_at)<Date.parse(p.created_at)||e.origin_action_id&&e.origin_action_id!==p.id||!r.planned_date||r.planned_date>r.business_date||!e.origin_action_id&&r.planned_date!==r.business_date)reject(422,'来源消费关系与完成事实不一致。');
  }else if(facts.length)reject(422,'来源完成缺少消费绑定。');
 }
 for(const r of w.records.filter(r=>r.schema_version===2&&r.completion_mode==='content'&&r.completion_effect==='complete'))if(!r.source_event_id||!w.content_events?.some(e=>e.event_id===r.source_event_id&&e.consumed_by===r.plan_id))reject(422,'内容完成缺少来源证明。');
}
/** Caller supplies the identity from the authenticated bridge, never a browser owner. */
export function validateSnapshot(snapshot:unknown,source:string,owner:string,now:Date):ActionWorkspace {
 const s=object(snapshot);if(s.snapshot_version!==2||s.source_account_id!==source)reject(422,'快照版本或来源账号不匹配。');
 if(Object.keys(s).some(k=>!['snapshot_version','source_account_id',...snapshotCollections].includes(k)))reject(422,'快照存在未知字段。');
 if(Buffer.byteLength(canonical(s))>4*1024*1024)reject(422,'快照超过接管容量。');
 for(const [i,key] of snapshotCollections.entries()){
  if(!Array.isArray(s[key])||s[key].length>limits[i])reject(422,'快照列表或数量无效。');
  for(const row of s[key])object(row);
  if(key!=='content_sources')unique(s[key],key==='content_events'?'event_id':['operations','claims'].includes(key)?'key':'id');
 }
 for(const p of s.plans){plan(p);if(Date.parse(p.created_at)>now.getTime()||Date.parse(p.updated_at)>now.getTime())reject(422,'行动时间晚于接管时刻。');}
 for(const r of s.records)if(Date.parse(r.started_at)>now.getTime()||r.ended_at&&Date.parse(r.ended_at)>now.getTime())reject(422,'执行时间晚于接管时刻。');
 for(const e of s.content_events)if(Date.parse(e.confirmed_at)>now.getTime())reject(422,'来源确认时间晚于接管时刻。');
 const sources=s.content_sources.map((v:Json)=>{const t=target(v);if(!t||!['article','plan'].includes(t.kind)||canonical(t)!==canonical(v))reject(422,'来源清单无效。');return t;});
 if(new Set(sources.map(canonical)).size!==sources.length)reject(422,'来源清单重复。');
 unique(s.content_events,'request_key');
 const content_events:ActionContentEvent[]=s.content_events.map((e:Json)=>{
  if(e.owner!==source||Object.keys(e).some(k=>!['event_id','owner','normalized_target','confirmed_at','origin_action_id','planned_date_at_confirmation','timezone_at_confirmation','consumed_by','request_key','request_hash'].includes(k)))reject(422,'来源事件归属或字段无效。');
  text(e.request_key,160,true);hash(e.request_hash);
  const {owner:_,request_key,request_hash,...event}=e;return {...event,owner_id:owner,handoff_source:{account_id:source,request_key,request_hash}} as ActionContentEvent;
 });
 const w=normalizeWorkspace({plans:structuredClone(s.plans),records:structuredClone(s.records),reviews:structuredClone(s.reviews),reports:structuredClone(s.reports),claims:{},content_sources:sources,content_events});
 for(const p of w.plans){
  if(p.parent_id){const parent=w.plans.find(v=>v.id===p.parent_id);if(!parent||levels[parent.period]>=levels[p.period]||!p.start_date||!p.end_date||!parent.start_date||!parent.end_date||parent.start_date>p.start_date||parent.end_date<p.end_date||parent.timezone!==p.timezone)reject(422,'行动层级关系无效。');}
  if(p.completion_mode==='content'&&!sources.some((t:any)=>sameTarget(t,p.target)))reject(422,'内容行动缺少来源清单。');}
 records(w);events(w);
 for(const r of s.reviews)for(const key of ['worked','obstacles','next_action'])text(r[key]??'',2000);
 for(const r of s.reports){if(!['ready','failed'].includes(r.state))reject(409,'请先等待正在生成的总结结束。');text(r.text??'',8000);}
 for(const r of [...s.reviews,...s.reports]){if(!w.plans.some(p=>p.id===r.plan_id))reject(422,'复盘关联的行动不存在。');date(r.start_date);date(r.end_date);if(r.start_date>r.end_date)reject(422,'复盘日期无效。');stamp(r.created_at);}
 w.legacy_operations=Object.fromEntries(s.operations.map((op:Json)=>{text(op.key,160,true);hash(op.hash);object(op.result);return [op.key,{hash:op.hash,result:structuredClone(op.result)}];}));
 w.claims=Object.fromEntries(s.claims.map((c:Json)=>{text(c.key,160,true);return [c.key,stamp(c.claimed_at)];}));
 // Store the original legacy bytes/fields. Adapters above exist only for validation.
 w.plans=structuredClone(s.plans);w.records=structuredClone(s.records);
 return w;
}

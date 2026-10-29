import {generateSummary,prepareSummary,publicReport,recoverSummaries,runSummary,type SummaryGenerator} from './action.summary.ts';
import {randomUUID} from 'node:crypto';
import type {LightTickRepository} from '../lighttick.repository.ts';
import type {LightTickOwner} from '../lighttick.types.ts';
import {emptyWorkspace,type ActionWorkspace,type Json} from './action.types.ts';
import {digest,object,text,integer,getPlan,reject,localParts,businessDay,activeAncestors} from './action.validation.ts';
import {createPlans,mutatePlan,schedule} from './action.commands.ts';
import {listing,reviewContext,calendar} from './action.projections.ts';
import {normalizeWorkspace} from './action.facts.ts';
import {publicLearningProgress} from './action-learning-progress.ts';
import {createPractice,practiceSource} from './action.practice.ts';
export class ActionService {
 constructor(readonly repository:LightTickRepository,readonly clock=()=>new Date(),readonly generator:SummaryGenerator=generateSummary,readonly p0WriteEnabled=false){}
 async readWorkspace(owner:LightTickOwner){return await this.repository.getActionWorkspace(owner)??{...owner,data:emptyWorkspace(),version:0};}
 async request(owner:LightTickOwner,method:string,path:string,body:unknown={},query:Json={},authorize?:()=>Promise<void>):Promise<Json|string>{
  let fresh:{report:Json;config:Json}|undefined;
  const value=await this.repository.transaction(owner,async()=>{
   const b=object(body);
   if(method==='POST'&&path==='/practices'&&b.source_kind==='record')await this.repository.lockRecordOwner(owner);
   await this.repository.lockActionOwner(owner);if(method!=='GET')await authorize?.();const stored=await this.readWorkspace(owner),row={...stored,data:normalizeWorkspace(stored.data)},w=row.data,now=this.clock();
   // The adapter is request-scoped. An unrelated write must not rewrite immutable
   // ended v1 facts; only a legacy running session can legitimately be settled.
   const legacyEnded=new Map(stored.data.records.filter(r=>r.schema_version!==2&&r.outcome!=='running').map(r=>[r.id,r]));
   const legacyPlans=new Map(stored.data.plans.filter(p=>p.schema_version!==2).map(p=>[p.id,p]));
   const adaptedPlans=new Map(w.plans.map(p=>[p.id,digest(p)]));
   const persist=()=>this.repository.saveActionWorkspace({...row,data:{...w,
    plans:w.plans.map(p=>legacyPlans.has(p.id)&&adaptedPlans.get(p.id)===digest(p)?legacyPlans.get(p.id)!:p),
    records:w.records.map(r=>legacyEnded.get(r.id)??r)}});
   if(method==='GET'){recoverSummaries(w,now);return this.read(w,path,query,now,row.version,owner);}
   if(method!=='POST')reject(405,'请求方式无效。');
   if(path==='/reviews/preview'){const facts=reviewContext(w,b);return {...facts,snapshot_hash:digest(facts)};}
   if(recoverSummaries(w,now)){row.version++;await persist();}
   if(/^\/action-[a-zA-Z0-9-]+\/reminder-claim$/.test(path)){
    const p=getPlan(w.plans,path.split('/')[1]),parts=localParts(now,p.timezone),identity=digest([text(b.device_id,80,true),p.id,text(b.reminder_at,80,true)]);
    const eligible=p.period==='day'&&p.status==='active'&&p.reminder&&p.reminder_at===b.reminder_at&&!!p.reminder_at&&Date.parse(p.reminder_at)<=now.getTime()&&p.start_date===businessDay(now,p.timezone)&&Number(parts.hour)>=8&&Number(parts.hour)<22&&!w.records.some(r=>r.outcome==='running'&&r.plan_id===p.id)&&activeAncestors(w.plans,p);
    const notify=eligible&&!w.claims[identity];if(notify){w.claims[identity]=now.toISOString();row.version++;await persist();}return {notify};
   }
   const key=text(b.key,160,true);if(key.length<8)reject(422,'请求编号过短。');
   const payloadHash=digest({method,path,body:path==='/reviews/generate'?Object.fromEntries(Object.entries(b).filter(([k])=>k!=='ai_config')):b}),old=await this.repository.getOperation(owner,'action:'+key);
   if(old){if(old.payloadHash!==payloadHash)reject(409,'同一请求编号不能提交不同内容。');return old.resultPayload;}
   if(w.legacy_operations&&Object.hasOwn(w.legacy_operations,key))reject(409,'这是接管前的请求，请刷新并核对已有计划后再操作。');
   let result:Json;
   if(path==='')result=createPlans(w,b,now);
   else if(path==='/practices')result=await createPractice(this.repository,owner,w,b,now);
   else if(path==='/schedules')result=schedule(w,b,now);
   else if(/^\/action-[a-zA-Z0-9-]+\/operations$/.test(path))result=mutatePlan(w,path.split('/')[1],b,now,owner.userId);
   else if(path==='/reviews/generate'){fresh=prepareSummary(w,b,now);result={report:publicReport(fresh.report)};}
   else if(path==='/reviews'){
    if(w.reviews.length>=2000)reject(422,'复盘数量已达首版容量上限。');
    const facts=reviewContext(w,b),review={...Object.fromEntries(['plan_id','start_date','end_date'].map(k=>[k,b[k]])),worked:text(b.worked??'',2000),obstacles:text(b.obstacles??'',2000),next_action:text(b.next_action??'',2000),id:'review-'+randomUUID().replaceAll('-',''),created_at:now.toISOString(),stats:facts.stats,plan_title:facts.plan.title};
    if(![review.worked,review.obstacles,review.next_action].some(s=>s.trim()))reject(422,'请至少填写一项复盘。');w.reviews.push(review);result={review};
   }else reject(404,'行动接口不存在。');
   row.version++;await persist();
   await this.repository.saveOperation({...owner,operationId:'action:'+key,deviceId:'actions',entityType:'action_workspace',entityId:'workspace',action:path,payloadHash,requestPayload:{},resultPayload:result!,status:'accepted',createdAt:now.toISOString(),updatedAt:now.toISOString()});
   return structuredClone(result!);
  });
  if(fresh)void runSummary(this,owner,fresh.report,fresh.config,this.generator).catch(()=>{});
  return value;
 }
 private async read(w:ActionWorkspace,path:string,q:Json,now:Date,version:number,owner:LightTickOwner):Promise<Json|string>{
  if(path==='')return listing(w,now,version,this.p0WriteEnabled);
  if(/^\/practices\/action-[a-zA-Z0-9-]+\/source$/.test(path))return practiceSource(this.repository,owner,w,path.split('/')[2]);
  if(path==='/practices'){
   if(q.source_kind&&!['lesson','record'].includes(q.source_kind))reject(422,'Invalid source kind.');
   const plans=listing(w,now,version,this.p0WriteEnabled).plans;
   return {practices:plans.filter((p:Json)=>p.practice_source&&(!q.source_kind||p.practice_source.kind===q.source_kind)&&(!q.source_id||p.practice_source.id===q.source_id))};
  }
  if(path==='/learning-progress')return {progress:publicLearningProgress(w)};
  if(path.startsWith('/requests/')){const key=text(path.slice(10),160,true),old=await this.repository.getOperation(owner,'action:'+key),legacy=w.legacy_operations&&Object.hasOwn(w.legacy_operations,key)?w.legacy_operations[key]:undefined;return {found:!!old||!!legacy,result:old?.resultPayload??legacy?.result??null};}
  if(path==='/records'){
   if(q.plan_id)getPlan(w.plans,q.plan_id);const page=integer(Number(q.page??1),1,100000),records=w.records.filter(r=>!q.plan_id||r.plan_id===q.plan_id).sort((a,b)=>(b.started_at+b.id).localeCompare(a.started_at+a.id));return {records:records.slice((page-1)*30,page*30),total:records.length,page};
  }
  if(path==='/reviews'){
   getPlan(w.plans,text(q.plan_id,80,true));const page=integer(Number(q.page??1),1,100000),order=(a:Json,b:Json)=>(b.created_at+b.id).localeCompare(a.created_at+a.id),reviews=w.reviews.filter(r=>r.plan_id===q.plan_id).sort(order),reports=w.reports.filter(r=>r.plan_id===q.plan_id).sort(order);
   return {reviews:reviews.slice((page-1)*20,page*20),reports:reports.slice((page-1)*20,page*20).map(({snapshot,worker,...r})=>r),page,review_total:reviews.length,report_total:reports.length};
  }
  if(/^\/action-[a-zA-Z0-9-]+\/calendar\.ics$/.test(path))return calendar(w,path.split('/')[1],now);
  reject(404,'行动接口不存在。');
 }
}

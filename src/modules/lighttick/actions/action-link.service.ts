import {createHmac,randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import type {LightTickRepository} from '../lighttick.repository.ts';import type {LightTickOwner} from '../lighttick.types.ts';
import type {ActionLink,ActionPlan,Json} from './action.types.ts';import {ActionService} from './action.service.ts';
import {canonical,digest,fields,validateParent,object,text,date,integer,reject} from './action.validation.ts';
export class ActionLinkService {
 constructor(readonly actions:ActionService,readonly secret:string,readonly clock=()=>new Date()){}
 get repository():LightTickRepository{return this.actions.repository;}
 requireConfigured(){if(this.secret.length<32)reject(503,'网页联动服务尚未配置。','SOURCE_DELIVERY_UNAVAILABLE');}
 verify(source:string,timestamp:string,nonce:string,signature:string,body:unknown){
  this.requireConfigured();text(source,160,true);
  if(!/^\d{10}$/.test(timestamp)||Math.abs(this.clock().getTime()/1000-Number(timestamp))>120||!/^[a-zA-Z0-9-]{16,100}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))reject(403,'联动请求已过期或签名无效。');
  const expected=createHmac('sha256',this.secret).update([source,timestamp,nonce,canonical(body)].join('\n')).digest('hex');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))reject(403,'联动请求签名无效。');
 }
 async ticket(owner:LightTickOwner){this.requireConfigured();return this.repository.transaction(owner,async()=>{
  await this.repository.lockActionOwner(owner);const code=randomBytes(18).toString('hex'),hash=digest(code),expires_at=new Date(this.clock().getTime()+300000).toISOString();
  await this.repository.saveActionTicket({...owner,hash,expires_at});const row=await this.actions.readWorkspace(owner);(row.data as Json).active_ticket_hash=hash;row.version++;await this.repository.saveActionWorkspace(row);
  return {code,expires_at,user_id:owner.userId};
 });}
 async preview(code:string,source:string){this.requireConfigured();const ticket=await this.requireTicket(code,source);return {target_user_id:ticket.userId,expires_at:ticket.expires_at,source_account_id:source};}
 private async requireTicket(code:string,source:string){
  if(!/^[a-f0-9]{36}$/.test(code))reject(422,'连接码无效。');const t=await this.repository.getActionTicket(digest(code));
  if(!t||Date.parse(t.expires_at)<=this.clock().getTime()||t.source_account_id&&t.source_account_id!==source)reject(409,'连接码已过期或已被其他账号使用。');
  const w=await this.actions.readWorkspace(t!);if((w.data as Json).active_ticket_hash!==t!.hash)reject(409,'连接码已更新，请使用客户端最新连接码。');return t!;
 }
 async claim(code:string,source:string):Promise<ActionLink>{
  const found=await this.requireTicket(code,source);return this.repository.transaction(found,async()=>{
   await this.repository.lockActionOwner(found);const t=await this.requireTicket(code,source),existing=await this.repository.getActionLink(source),ownerLink=await this.repository.getOwnerActionLink(t);
   if(existing&&existing.userId!==t.userId||ownerLink&&ownerLink.source_account_id!==source)reject(409,'其中一个账号已连接其他账号，请先核对连接关系。');
   const link=existing??{appId:'lighttick' as const,userId:t.userId,source_account_id:source,binding_id:'binding-'+randomUUID(),phase:'staged' as const};
   await this.repository.saveActionLink(link);await this.repository.saveActionTicket({...t,source_account_id:source});return link;
  });
 }
 async linked(source:string):Promise<ActionLink>{const link=await this.repository.getActionLink(source);if(!link)reject(404,'账号尚未连接。');return link!;}
 async import(source:string,input:Json){
  const link=await this.linked(source);return this.repository.transaction(link,async()=>{
   await this.repository.lockActionOwner(link);const current=await this.linked(source),snapshot=object(input.snapshot),hash=text(input.snapshot_hash,64,true);
   if(digest(snapshot)!==hash)reject(422,'导入快照校验失败。');
   if(current.import_hash){if(current.import_hash!==hash)reject(409,'这个连接已经接管其他快照，禁止覆盖。');return current.receipt!;}
   for(const name of ['plans','records','reviews','reports','operations','claims'])if(!Array.isArray(snapshot[name]))reject(422,'导入对象列表无效。');
   for(const item of [...snapshot.plans,...snapshot.records])object(item);
   if(snapshot.snapshot_version!==undefined&&snapshot.snapshot_version!==1||snapshot.schema_version!==undefined&&snapshot.schema_version!==1||snapshot.content_sources||snapshot.content_events||snapshot.events||snapshot.plans.some((p:Json)=>p.schema_version!==undefined&&p.schema_version!==1||p.completion_mode&&p.completion_mode!=='time')||snapshot.records.some((r:Json)=>r.schema_version!==undefined&&r.schema_version!==1||r.record_kind||r.source_event_id))
    reject(409,'P0快照接管仍待事件和双端合同验证。','CONTRACT_UPGRADE_REQUIRED');
   if(Buffer.byteLength(canonical(snapshot))>4*1024*1024)reject(422,'快照超过首版导入上限，原始数据保留。');
   const row=await this.actions.readWorkspace(current),w=row.data;
   const plans:ActionPlan[]=snapshot.plans.map((v:Json)=>{
    const p={...fields(v),id:text(v.id,80,true),schema_version:1 as const,completed_at:null,completion_record_id:null,revision:integer(v.revision,1,2147483647),status:v.status,created_at:text(v.created_at,80,true),updated_at:text(v.updated_at,80,true),reminder_at:text(v.reminder_at,80,true)};
    if(!/^action-[a-zA-Z0-9-]+$/.test(p.id)||!['active','paused','completed','archived'].includes(p.status)||![p.created_at,p.updated_at,p.reminder_at].every(t=>Number.isFinite(Date.parse(t))))reject(422,'计划快照无效。');return p;
   });
   const merge=(old:Json[],incoming:Json[])=>{const ids=new Set<string>();for(const item of incoming){const id=text(item.id,160,true);if(ids.has(id))reject(422,'快照含重复对象。');ids.add(id);const previous=old.find(p=>p.id===id);if(previous&&digest(previous)!==digest(item))reject(409,'源对象与现有对象冲突。');if(!previous)old.push(structuredClone(item));}};
   merge(w.plans,plans);if(w.plans.length>1000)reject(422,'接管后的计划数量超过首版容量。');for(const p of w.plans)validateParent(w.plans,p);
   for(const r of snapshot.records){getExistingPlan(w.plans,r.plan_id);text(r.id,80,true);date(r.business_date);integer(r.actual_minutes,0,1440);integer(r.planned_minutes,1,1440);text(r.title,160,true);text(r.note??'',2000);
    if(!Number.isFinite(Date.parse(text(r.started_at,80,true)))||r.ended_at!==null&&!Number.isFinite(Date.parse(text(r.ended_at,80,true)))||!['standard','minimum'].includes(r.variant)||!['running','completed','minimum','partial','interrupted'].includes(r.outcome))reject(422,'执行结果无效。');
    try{new Intl.DateTimeFormat('en',{timeZone:text(r.timezone,80,true)});}catch{reject(422,'执行时区无效。');}
   }
   merge(w.records,snapshot.records);if(w.records.length>10000||w.records.filter(r=>r.outcome==='running').length>1)reject(409,'已有执行正在进行或记录超过容量，请先核对。');
   for(const r of snapshot.reviews){getExistingPlan(w.plans,r.plan_id);date(r.start_date);date(r.end_date);for(const key of ['worked','obstacles','next_action'])text(r[key]??'',2000);}
   merge(w.reviews,snapshot.reviews);if(w.reviews.length>2000)reject(422,'复盘数量超过首版容量。');
   merge(w.reports,snapshot.reports.map((r:Json)=>r.state==='generating'?{...r,state:'failed',error:'接管前的生成已停止，请主动重新生成。'}:r));
   if(w.reports.length>1000)reject(422,'总结数量超过首版容量。');
   w.legacy_operations??={};for(const op of snapshot.operations)w.legacy_operations[text(op.key,160,true)]={hash:text(op.hash,64,true),result:object(op.result)};
   for(const claim of snapshot.claims)w.claims[text(claim.key,160,true)]=text(claim.claimed_at,80,true);
   row.version++;await this.repository.saveActionWorkspace(row);
   const source_counts=Object.fromEntries(['plans','records','reviews','reports','operations','claims'].map(k=>[k,snapshot[k].length]));
   const receipt={binding_id:current.binding_id,target_user_id:current.userId,snapshot_hash:hash,source_counts,imported_at:this.clock().toISOString()};
   await this.repository.saveActionLink({...current,phase:'active',import_hash:hash,receipt});return receipt;
  });
 }
}
function getExistingPlan(plans:ActionPlan[],id:string){if(!plans.some(p=>p.id===id))reject(422,'导入记录关联的计划不存在。');}

import type {ActionLinkService} from './action-link.service.ts';
import type {ActionWorkspace,Json} from './action.types.ts';
import {object,text,digest,integer,reject,canonical} from './action.validation.ts';
import {sourceReceipt,handoffEventPayload} from './action.source-receipt.ts';
import {validateSnapshot,snapshotCounts} from './action-handoff.validation.ts';

/** C3 internal infrastructure. Deliberately not wired to a public write route. */
export class ActionHandoffService {
 constructor(readonly links:ActionLinkService){}
 async preflight(source:string,input:Json){return this.execute(source,input,false);}
 async import(source:string,input:Json){return this.execute(source,input,true);}
 private async execute(source:string,input:Json,commit:boolean):Promise<Json>{
  this.links.requireConfigured();const initial=await this.links.linked(source),repo=this.links.repository;
  return repo.transaction(initial,async()=>{
   await repo.lockActionOwner(initial);const link=await this.links.linked(source),snapshot=object(input.snapshot),hash=text(input.snapshot_hash,64,true);
   if(link.userId!==initial.userId||link.binding_id!==input.binding_id)reject(409,'接管连接已变化。');
   if(!/^[a-f0-9]{64}$/.test(hash)||digest(snapshot)!==hash)reject(422,'导入快照校验失败。');
   if(link.import_hash){if(link.import_hash!==hash)reject(409,'这个连接已经接管其他快照，禁止覆盖。');return link.receipt!;}
   if(link.phase!=='staged')reject(409,'只允许预备中的连接执行接管。');
   const incoming=validateSnapshot(snapshot,source,link.userId,this.links.clock()),row=await this.links.actions.readWorkspace(link);
   const merged=await this.merge(row.data,incoming,link);
   for(const event of incoming.content_events??[])if(await repo.getOperation(link,'source:'+link.binding_id+':'+event.event_id))reject(409,'来源接管回执编号与目标冲突。');
   // Revalidate the entire combined graph, not just individual incoming rows.
   validateSnapshot({...snapshot,plans:merged.plans,records:merged.records,reviews:merged.reviews,reports:merged.reports,
    operations:Object.entries(merged.legacy_operations??{}).map(([key,v])=>({key,...v})),claims:Object.entries(merged.claims).map(([key,claimed_at])=>({key,claimed_at})),
    content_sources:merged.content_sources??[],content_events:(merged.content_events??[]).map(e=>{
     const {owner_id,handoff_source,...rest}=e,original=snapshot.content_events.find((v:Json)=>v.event_id===e.event_id);
     return {...rest,owner:source,request_key:original?.request_key??e.event_id,request_hash:original?.request_hash??digest(e)};
    })},source,link.userId,this.links.clock());
   const receipt={binding_id:link.binding_id,target_user_id:link.userId,snapshot_hash:hash,source_counts:snapshotCounts(snapshot),target_version:row.version};
   if(!commit)return {...receipt,validated:true};
   if(integer(input.target_version,0,2147483647)!==row.version)reject(409,'预检后的目标数据已变化，请重新预检。','REVISION_CONFLICT',{reason:'HANDOFF_TARGET_VERSION_CHANGED'});
   const imported={...receipt,imported_at:this.links.clock().toISOString()};
   for(const event of merged.content_events??[])Object.assign(event,{binding_id:link.binding_id,delivery_hash:digest(handoffEventPayload(event))});
   await repo.saveActionWorkspace({...row,data:merged,version:row.version+1});
   for(const event of merged.content_events??[])await repo.saveOperation({...link,operationId:'source:'+link.binding_id+':'+event.event_id,deviceId:'grow-source',entityType:'action_workspace',entityId:'workspace',action:'source-confirmation',payloadHash:event.delivery_hash!,requestPayload:{},resultPayload:sourceReceipt(link,event,merged),status:'accepted',createdAt:imported.imported_at,updatedAt:imported.imported_at});
   await repo.saveActionLink({...link,phase:'active',import_hash:hash,receipt:imported});
   return imported;
  });
 }
 private async merge(current:ActionWorkspace,incoming:ActionWorkspace,owner:{appId:'lighttick';userId:string}){
  const w=structuredClone(current);
  for(const key of ['plans','records','reviews','reports','content_events'] as const){
   const prior=(w[key]??[]) as Json[],rows=(incoming[key]??[]) as Json[],id=key==='content_events'?'event_id':'id';
   for(const value of rows){const found=prior.find(v=>v[id]===value[id]);if(found&&digest(found)!==digest(value))reject(409,'源对象与现有对象冲突。');if(!found)prior.push(structuredClone(value));}
   (w as Json)[key]=prior;
  }
  // Existing remotely delivered inventory carries a different provenance domain.
  // A staged handoff cannot absorb another binding's source receipts.
  if((current.content_events??[]).length)reject(409,'目标已有来源事件，请先人工核对连接归属。');
  w.content_sources=[...new Map([...(w.content_sources??[]),...(incoming.content_sources??[])].map(t=>[canonical(t),t])).values()];
  w.legacy_operations??={};
  for(const [key,value] of Object.entries(incoming.legacy_operations??{})){
   if(await this.links.repository.getOperation(owner,'action:'+key)||Object.hasOwn(w.legacy_operations,key)&&digest(w.legacy_operations[key])!==digest(value))reject(409,'接管请求编号与目标已有回执冲突。');
   Object.defineProperty(w.legacy_operations,key,{value,enumerable:true,writable:true,configurable:true});
  }
  for(const [key,value] of Object.entries(incoming.claims)){
   if(Object.hasOwn(w.claims,key)&&w.claims[key]!==value)reject(409,'接管提醒回执与目标冲突。');Object.defineProperty(w.claims,key,{value,enumerable:true,writable:true,configurable:true});
  }
  if(w.reports.some(r=>r.state==='generating'))reject(409,'请先等待正在生成的总结结束。');
  return w;
 }
}

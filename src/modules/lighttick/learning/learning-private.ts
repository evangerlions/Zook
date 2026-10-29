import type {ActionService} from '../actions/action.service.ts';
import type {ActionLink,Json} from '../actions/action.types.ts';
import type {LightTickOwner} from '../lighttick.types.ts';
import {digest,integer,keys,object,reject,text} from '../actions/action.validation.ts';

function answers(value:unknown){
 if(!Array.isArray(value)||value.length>100)reject(422,'Bounded answers are required.');
 const ids=new Set<string>();let size=0;
 return value.map(v=>{const a=object(v);keys(a,['id','prompt','answer']);const id=text(a.id,500,true),prompt=text(a.prompt,1000),answer=text(a.answer,10000);size+=answer.length;if(ids.has(id)||size>60000)reject(422,'Invalid answers.');ids.add(id);return {id,prompt,answer};});
}
function snapshot(value:unknown):Json {
 const s=object(value);keys(s,['id','content_version','draft_version','revision','notes','answers','questions','completed','completed_at','position','updated_at']);
 if(typeof s.completed!=='boolean')reject(422,'Explicit completion state required.');
 const id=text(s.id,80,true),content_version=text(s.content_version,64,true),updated_at=text(s.updated_at,80,true);
 if(!/^[a-f0-9]{64}$/.test(s.draft_version)||!/^lesson-[a-z0-9-]+$/.test(id)||!/^([a-f0-9]{64})$/.test(content_version)||!Number.isFinite(Date.parse(updated_at)))reject(422,'Invalid private lesson version.');
 const completed_at=s.completed_at===null?null:text(s.completed_at,80,true);if(completed_at!==null&&!Number.isFinite(Date.parse(completed_at)))reject(422,'Invalid completion timestamp.');
 return {id,content_version,draft_version:text(s.draft_version,64,true),revision:integer(s.revision,1,2147483647),notes:text(s.notes,10000),answers:answers(s.answers),questions:answers(s.questions),completed:s.completed,completed_at,position:integer(s.position,0,100000),updated_at};
}
async function scope(actions:ActionService,owner:LightTickOwner){
 const link=await actions.repository.getOwnerActionLink(owner),library=await actions.repository.getLearningLibrary(owner);
 if(!link||!library?.consent_enabled||library.binding_id!==link.binding_id)reject(403,'Course reading consent is required.');
 return {link:link!,library};
}
/** Source remains the sole private-state writer. Phone commands are durable until source receipts arrive. */
export async function exchangePrivate(actions:ActionService,initial:ActionLink,b:Json,authorize?:()=>Promise<void>){
 keys(b,['action','action_schema_version','binding_id','source_revision','enabled','lessons','results']);
 if(b.action_schema_version!==2||b.binding_id!==initial.binding_id||typeof b.enabled!=='boolean'||!Array.isArray(b.lessons)||b.lessons.length>200||!Array.isArray(b.results)||b.results.length>1000)reject(422,'Invalid private learning exchange.');
 const lessons=b.lessons.map(snapshot),seen=new Set(lessons.map(l=>l.id));if(seen.size!==lessons.length||!b.enabled&&(lessons.length||b.results.length))reject(422,'Private scope must be explicit.');
 const source_revision=integer(b.source_revision,1,2147483647),hash=digest({enabled:b.enabled,lessons,results:b.results});
 if(Buffer.byteLength(JSON.stringify(b))>6*1024*1024)reject(413,'Private learning capacity exceeded.');
 return actions.repository.transaction(initial,async()=>{
  await actions.repository.lockActionOwner(initial);await authorize?.();const {link,library}=await scope(actions,initial);
  if(link.binding_id!==initial.binding_id)reject(409,'Private binding changed.');
  const old=await actions.repository.getLearningPrivate(link),same=old?.binding_id===link.binding_id;
  if(same&&(old!.source_revision>source_revision||old!.source_revision===source_revision&&old!.hash!==hash))reject(409,'Private source revision changed.');
  let row:Json=same?old!:{binding_id:link.binding_id,requests:[],lessons:[],source_revision:0};
  if(source_revision>row.source_revision){
   for(const l of lessons){if(!library.lessons.some((c:Json)=>c.id===l.id&&c.content_version===l.content_version))reject(409,'Refresh the published lesson first.');}
   const requests:Json[]=structuredClone(row.requests);
   for(const value of b.results){const r=object(value);keys(r,['id','status','error']);const request=requests.find(x=>x.id===r.id);if(!request||!['applied','conflict','unavailable'].includes(r.status))reject(422,'Unknown private command receipt.');const error=text(r.error,500);if(request.status!=='pending'&&(request.status!==r.status||request.error!==error))reject(409,'Command receipt changed.');request.status=r.status;request.error=error;delete request.body;}
   row={...row,enabled:b.enabled,source_revision,hash,lessons,requests:b.enabled?requests:[]};await actions.repository.saveLearningPrivate(link,row);
  }
  return {accepted:true,binding_id:link.binding_id,source_revision,requests:row.enabled?row.requests.filter((r:Json)=>r.status==='pending').slice(0,20).map((r:Json)=>r.body):[]};
 });
}
export async function privateLearning(actions:ActionService,owner:LightTickOwner,id:string,body?:Json,authorize?:()=>Promise<void>):Promise<Json>{
 return actions.repository.transaction(owner,async()=>{
  await actions.repository.lockActionOwner(owner);await authorize?.();const {link,library}=await scope(actions,owner);
  const lesson=library.lessons.find((l:Json)=>l.id===id);if(!lesson)reject(404,'Lesson is unavailable.');
  const row=await actions.repository.getLearningPrivate(owner),enabled=!!row?.enabled&&row.binding_id===link.binding_id;
  if(body){
   if(!enabled)reject(403,'Allow private notes, answers and completion separately in Grow.');
   keys(body,['id','content_version','revision','action','notes','answers','position']);
   const key=text(body.id,80,true);if(!/^[a-zA-Z0-9-]{8,80}$/.test(key)||!['save','complete','position'].includes(body.action))reject(422,'Invalid private command.');
   const input={id:key,lesson_id:id,content_version:text(body.content_version,64,true),revision:integer(body.revision,1,2147483647),action:body.action,notes:text(body.notes,10000),answers:answers(body.answers),position:integer(body.position,0,100000)},hash=digest(input);
   const old=row!.requests.find((r:Json)=>r.id===key);
   if(old){if(old.hash!==hash)reject(409,'Request identity was reused.');}
   else {
    if(input.content_version!==lesson!.content_version||row!.lessons.find((l:Json)=>l.id===id)?.revision!==input.revision)reject(409,'Private state changed. Keep local input and compare the source.','REVISION_CONFLICT');
    if(row!.requests.filter((r:Json)=>r.status==='pending').length>=20)reject(413,'Too many private commands are awaiting the source.');
    if(row!.requests.length>=1000)reject(413,'Private command history is at capacity.');
    row!.requests.push({id:key,lesson_id:id,hash,status:'pending',error:'',body:input});if(Buffer.byteLength(JSON.stringify(row))>12*1024*1024)reject(413,'Private workspace capacity exceeded.');await actions.repository.saveLearningPrivate(owner,row!);
   }
  }
  return {enabled,state:enabled?row!.lessons.find((l:Json)=>l.id===id)??null:null,operations:enabled?row!.requests.filter((r:Json)=>r.lesson_id===id).map(({id,status,error}:Json)=>({id,status,error})):[]};
 });
}

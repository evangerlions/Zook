import type {ActionService} from '../actions/action.service.ts';
import type {ActionLink,Json} from '../actions/action.types.ts';
import type {LightTickOwner} from '../lighttick.types.ts';
import {digest,integer,keys,object,reject,text} from '../actions/action.validation.ts';
export async function receiveLibrary(actions:ActionService,initial:ActionLink,input:Json,authorize?:()=>Promise<void>):Promise<Json>{
 keys(input,['action','action_schema_version','binding_id','source_revision','observed_at','consent_enabled','lessons']);
 if(input.action_schema_version!==2||input.binding_id!==initial.binding_id)reject(403,'Reading source binding does not match.');
 if(typeof input.consent_enabled!=='boolean'||!Array.isArray(input.lessons)||input.lessons.length>200||!input.consent_enabled&&input.lessons.length)reject(422,'Explicit reading consent and bounded lessons are required.');
 const source_revision=integer(input.source_revision,1,2147483647),observed_at=text(input.observed_at,80,true);
 if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(observed_at)||!Number.isFinite(Date.parse(observed_at))||Date.parse(observed_at)>actions.clock().getTime()+120000)reject(422,'Invalid source observation time.');
 const ids=new Set<string>(),lessons=input.lessons.map((value:unknown)=>{
  const l=object(value);keys(l,['id','collection_id','collection_title','number','title','content_version','content','references','learning_state','source_url']);
  const id=text(l.id,80,true),collection_id=text(l.collection_id,100,true),collection_title=text(l.collection_title,500,true),title=text(l.title,500,true),number=integer(l.number,1,100000);
  if(!/^lesson-[a-z0-9-]{1,70}$/.test(id)||ids.has(id)||!['unknown','completed'].includes(l.learning_state))reject(422,'Invalid lesson identity or source state.');ids.add(id);
  const content=text(l.content,100000,true),references=text(l.references,100000),content_version=digest({content,references}),source_url=text(l.source_url,1500,true);let url:URL;
  try{url=new URL(source_url);}catch{reject(422,'Invalid source URL.');}
  if(url!.username||url!.password||url!.search||url!.protocol!=='https:'&&!(url!.protocol==='http:'&&['localhost','127.0.0.1'].includes(url!.hostname)))reject(422,'A safe source URL is required.');
  if(l.content_version!==content_version)reject(422,'Lesson version does not match its published content.');
  return {id,collection_id,collection_title,number,title,content_version,content,references,learning_state:l.learning_state,source_url};
 });
 const value={source_revision,observed_at,consent_enabled:input.consent_enabled,lessons},payload_hash=digest(value);
 if(Buffer.byteLength(JSON.stringify(value))>4*1024*1024)reject(413,'Reading library exceeds its current capacity.');
 return actions.repository.transaction(initial,async()=>{
  await actions.repository.lockActionOwner(initial);await authorize?.();const link=await actions.repository.getActionLink(initial.source_account_id);
  if(!link||link.binding_id!==initial.binding_id||link.userId!==initial.userId)reject(409,'Reading requires the current active binding.');
  const previous=await actions.repository.getLearningLibrary(link);
  if(previous?.binding_id===link.binding_id&&(previous.source_revision>source_revision||previous.source_revision===source_revision&&previous.payload_hash!==payload_hash))reject(409,'Reading source revision changed.','REVISION_CONFLICT');
  if(!previous||previous.binding_id!==link.binding_id||previous.source_revision<source_revision)await actions.repository.saveLearningLibrary(link,{...value,binding_id:link.binding_id,payload_hash,received_at:actions.clock().toISOString()});
  if(!input.consent_enabled)await actions.repository.saveLearningPrivate(link,{binding_id:link.binding_id,enabled:false,source_revision:0,lessons:[],requests:[]});
  return {accepted:true,binding_id:link.binding_id,target_user_id:link.userId,source_revision,payload_hash};
 });
}
export async function readLibrary(actions:ActionService,owner:LightTickOwner,id?:string):Promise<Json>{
 const link=await actions.repository.getOwnerActionLink(owner),row=await actions.repository.getLearningLibrary(owner);
 const active=!!link&&row?.binding_id===link.binding_id&&row?.consent_enabled===true;
 if(id){const lesson=active&&row?.lessons.find((l:Json)=>l.id===id);if(!lesson)reject(404,'Course is unavailable or reading consent was withdrawn.');return {lesson,observed_at:row!.observed_at,binding_id:link!.binding_id};}
 return {consent_enabled:!!active,binding_id:active?link!.binding_id:null,observed_at:active?row!.observed_at:null,lessons:active?row!.lessons.map(({content,references,...l}:Json)=>l):[]};
}

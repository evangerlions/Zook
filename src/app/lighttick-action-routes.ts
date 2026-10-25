import {receiveLibrary,readLibrary} from '../modules/lighttick/learning/learning-library.ts';
import type {BackendRouteContext} from './backend-route-context.ts';
import type {LightTickRuntime} from '../modules/lighttick/lighttick-runtime.ts';
import type {HttpRequest,HttpResponse} from '../shared/types.ts';
import type {LightTickOwner} from '../modules/lighttick/lighttick.types.ts';
import {object,reject,text} from '../modules/lighttick/actions/action.validation.ts';
import {requireActionSchema,rejectConnectionWrite,actionErrorResponse} from '../modules/lighttick/actions/action.gates.ts';
import {ActionHandoffService} from '../modules/lighttick/actions/action-handoff.service.ts';
import {ActionSourceService} from '../modules/lighttick/actions/action-source.service.ts';
import {receiveLearningProgress} from '../modules/lighttick/actions/action-learning-progress.ts';
const prefix='/api/v1/lighttick/action-plans',learningPrefix='/api/v1/lighttick/learning-library';

export async function tryHandleLightTickActionRoutes(context:BackendRouteContext,enabled:boolean,runtime:LightTickRuntime|undefined,r:HttpRequest):Promise<HttpResponse<unknown>|undefined>{
 if(![prefix,learningPrefix,'/api/v1/lighttick/action-link-tickets','/api/v1/lighttick/grow-bridge'].some(p=>r.path===p||r.path.startsWith(p+'/')))return;
 try{return await handle(context,enabled,runtime,r);}
 catch(error){const response=actionErrorResponse(error,r.requestId??'');if(response)return response;throw error;}
}

async function handle(context:BackendRouteContext,enabled:boolean,runtime:LightTickRuntime|undefined,r:HttpRequest):Promise<HttpResponse<unknown>> {
 if(!enabled||!runtime||!runtime.actionsEnabled)reject(503,'Action service is not enabled.');
 let result:unknown;
 if(r.path==='/api/v1/lighttick/grow-bridge'){
  if(r.method!=='POST')reject(405,'Use POST for the signed bridge.');
  const data=object(r.body??{}),source=r.headers['x-grow-account-id']??'';
  if(Buffer.byteLength(JSON.stringify(data))>5*1024*1024)reject(413,'Bridge request capacity exceeded.');
  runtime.actionLinks.verify(source,r.headers['x-grow-timestamp']??'',r.headers['x-grow-nonce']??'',r.headers['x-grow-signature']??'',data);
  if(data.action==='preview')result=await runtime.actionLinks.preview(text(data.code,80,true),source);
  else if(data.action==='claim'){
   const target=await runtime.actionLinks.preview(text(data.code,80,true),source);
   await requireMember(context,target.target_user_id);rejectConnectionWrite(runtime.actions.p0WriteEnabled);
   result=await runtime.actionLinks.claim(text(data.code,80,true),source);
  }else {
   const link=await runtime.actionLinks.linked(source);await requireMember(context,link.userId);
   if(['import-preflight','import'].includes(data.action) && runtime.actions.p0WriteEnabled){
    const handoff=new ActionHandoffService(runtime.actionLinks);
    result=data.action==='import-preflight'?await handoff.preflight(source,data):await handoff.import(source,data);
   }else{
   if(data.action==='import')rejectConnectionWrite(runtime.actions.p0WriteEnabled);
   if(link.phase!=='active')reject(409,'Handoff is pending.');
   if(data.action==='learning-library'){
    rejectConnectionWrite(runtime.actions.p0WriteEnabled);result=await receiveLibrary(runtime.actions,link,data,()=>requireMember(context,link.userId));
   }else if(data.action==='learning-progress'){
    rejectConnectionWrite(runtime.actions.p0WriteEnabled);result=await receiveLearningProgress(runtime.actions,link,data);
   }else if(['source-context','source-confirmation','source-receipt','source-reconcile'].includes(data.action)){
    if(Buffer.byteLength(JSON.stringify(data))>16000)reject(413,'Source event capacity exceeded.');
    const sources=new ActionSourceService(runtime.actions,runtime.actionLinks.secret,runtime.actions.clock);
    if(data.action==='source-context')result=await sources.context(link,data);
    else if(data.action==='source-confirmation')result=await sources.receive(link,data);
    else result=await sources.reconcile(link,data,data.action==='source-receipt');
   }else{
    if(data.action!=='request')reject(422,'Unsupported bridge operation.');
    const method=text(data.method,8,true),path=text(data.path,300);
    if(method==='POST'){requireActionSchema(data.action_schema_version);if(path!=='/reviews/preview')rejectConnectionWrite(runtime.actions.p0WriteEnabled);}
    else if(method!=='GET')reject(405,'Unsupported request method.');
    result=await runtime.actions.request(link,method,path,data.body??{},object(data.query??{}),()=>requireMember(context,link.userId));
   }
   }
  }
 }else {
  const auth=await context.authenticateProductRequest(r,'lighttick'),owner:LightTickOwner={appId:'lighttick',userId:auth.userId};
  if(runtime.guestIdentity&&await runtime.guestIdentity.getActive(auth.userId))reject(403,'A registered account is required.');
  if(r.method==='POST'){
   requireActionSchema(r.headers['x-grow-action-schema']);
   if(r.path!==prefix+'/reviews/preview')rejectConnectionWrite(runtime.actions.p0WriteEnabled);
  }
  if(r.path==='/api/v1/lighttick/action-link-tickets'){
   if(r.method!=='POST')reject(405,'Use POST for a connection ticket.');
   result=await runtime.actionLinks.ticket(owner);
   return context.ok(result,r.requestId as string,{'Cache-Control':'no-store'});
  }
  const data=object(r.body??{});if(Buffer.byteLength(JSON.stringify(data))>30000)reject(413,'Action request capacity exceeded.');
  if(r.method==='GET'&&(r.path===learningPrefix||r.path.startsWith(learningPrefix+'/'))){
   result=await readLibrary(runtime.actions,owner,r.path===learningPrefix?undefined:r.path.slice((learningPrefix+'/').length));
  }else result=await runtime.actions.request(owner,r.method,r.path.slice(prefix.length),data,r.query??{},()=>requireMember(context,owner.userId));
 }
 return context.ok(result,r.requestId as string,{'Cache-Control':'no-store'});
}

async function requireMember(context:BackendRouteContext,userId:string){
 const membership=await context.database.findAppUser('lighttick',userId),user=await context.database.findUserById(userId);
 if(membership?.status!=='ACTIVE'||user?.status!=='ACTIVE')reject(403,'The LightTick account is not active.');
}

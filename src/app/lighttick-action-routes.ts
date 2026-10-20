import type {BackendRouteContext} from './backend-route-context.ts';
import type {LightTickRuntime} from '../modules/lighttick/lighttick-runtime.ts';
import type {HttpRequest,HttpResponse} from '../shared/types.ts';
import type {LightTickOwner} from '../modules/lighttick/lighttick.types.ts';
import {object,reject,text} from '../modules/lighttick/actions/action.validation.ts';
import {requireActionSchema,rejectConnectionWrite,actionErrorResponse} from '../modules/lighttick/actions/action.gates.ts';
import {ActionSourceService} from '../modules/lighttick/actions/action-source.service.ts';
const prefix='/api/v1/lighttick/action-plans';

export async function tryHandleLightTickActionRoutes(context:BackendRouteContext,enabled:boolean,runtime:LightTickRuntime|undefined,r:HttpRequest):Promise<HttpResponse<unknown>|undefined>{
 if(![prefix,'/api/v1/lighttick/action-link-tickets','/api/v1/lighttick/grow-bridge'].some(p=>r.path===p||r.path.startsWith(p+'/')))return;
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
  else {
   if(data.action==='claim'){
    const target=await runtime.actionLinks.preview(text(data.code,80,true),source);
    await requireMember(context,target.target_user_id);rejectConnectionWrite();
   }
   const link=await runtime.actionLinks.linked(source);await requireMember(context,link.userId);
   if(data.action==='import')rejectConnectionWrite();
   if(link.phase!=='active')reject(409,'Handoff is pending.');
   if(['source-context','source-confirmation','source-receipt','source-reconcile'].includes(data.action)){
    if(Buffer.byteLength(JSON.stringify(data))>16000)reject(413,'Source event capacity exceeded.');
    const sources=new ActionSourceService(runtime.actions,runtime.actionLinks.secret,runtime.actions.clock);
    if(data.action==='source-context')result=await sources.context(link,data);
    else if(data.action==='source-confirmation')result=await sources.receive(link,data);
    else result=await sources.reconcile(link,data,data.action==='source-receipt');
   }else{
    if(data.action!=='request')reject(422,'Unsupported bridge operation.');
    const method=text(data.method,8,true),path=text(data.path,300);
    if(method==='POST'){requireActionSchema(data.action_schema_version);if(path!=='/reviews/preview')rejectConnectionWrite();}
    else if(method!=='GET')reject(405,'Unsupported request method.');
    result=await runtime.actions.request(link,method,path,data.body??{},object(data.query??{}));
   }
  }
 }else {
  const auth=await context.authenticateProductRequest(r,'lighttick'),owner:LightTickOwner={appId:'lighttick',userId:auth.userId};
  if(runtime.guestIdentity&&await runtime.guestIdentity.getActive(auth.userId))reject(403,'A registered account is required.');
  if(r.method==='POST'){
   requireActionSchema(r.headers['x-grow-action-schema']);
   if(r.path!==prefix+'/reviews/preview')rejectConnectionWrite();
  }
  if(r.path==='/api/v1/lighttick/action-link-tickets')reject(405,'New handoff is not enabled.');
  const data=object(r.body??{});if(Buffer.byteLength(JSON.stringify(data))>30000)reject(413,'Action request capacity exceeded.');
  result=await runtime.actions.request(owner,r.method,r.path.slice(prefix.length),data,r.query??{});
 }
 return context.ok(result,r.requestId as string,{'Cache-Control':'no-store'});
}

async function requireMember(context:BackendRouteContext,userId:string){
 const membership=await context.database.findAppUser('lighttick',userId),user=await context.database.findUserById(userId);
 if(membership?.status!=='ACTIVE'||user?.status!=='ACTIVE')reject(403,'The LightTick account is not active.');
}

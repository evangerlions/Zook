import type {BackendRouteContext} from './backend-route-context.ts';import type {LightTickRuntime} from '../modules/lighttick/lighttick-runtime.ts';
import type {HttpRequest,HttpResponse} from '../shared/types.ts';import type {LightTickOwner} from '../modules/lighttick/lighttick.types.ts';
import {object,reject,text} from '../modules/lighttick/actions/action.validation.ts';
const prefix='/api/v1/lighttick/action-plans';
export async function tryHandleLightTickActionRoutes(context:BackendRouteContext,enabled:boolean,runtime:LightTickRuntime|undefined,r:HttpRequest):Promise<HttpResponse<unknown>|undefined>{
 if(![prefix,'/api/v1/lighttick/action-link-tickets','/api/v1/lighttick/grow-bridge'].some(p=>r.path===p||r.path.startsWith(p+'/')))return undefined;
 if(!enabled||!runtime||!runtime.actionsEnabled)reject(503,'行动计划联动尚未在当前服务开通。');
 const data=object(r.body??{});if(Buffer.byteLength(JSON.stringify(data))>5*1024*1024)reject(413,'请求超过联动容量上限。');
 let result:unknown;
 if(r.path==='/api/v1/lighttick/grow-bridge'){
  if(r.method!=='POST')reject(405,'联动请求方式无效。');
  const source=r.headers['x-grow-account-id']??'';
  runtime.actionLinks.verify(source,r.headers['x-grow-timestamp']??'',r.headers['x-grow-nonce']??'',r.headers['x-grow-signature']??'',data);
  if(data.action==='preview'){result=await runtime.actionLinks.preview(text(data.code,80,true),source);}
  else {
   if(data.action==='claim'){
    const target=await runtime.actionLinks.preview(text(data.code,80,true),source),membership=await context.database.findAppUser('lighttick',target.target_user_id),user=await context.database.findUserById(target.target_user_id);
    if(membership?.status!=='ACTIVE'||user?.status!=='ACTIVE')reject(403,'LightTick 账号不可用，请在客户端恢复访问。');
   }
   const link=data.action==='claim'?await runtime.actionLinks.claim(text(data.code,80,true),source):await runtime.actionLinks.linked(source);
   const membership=await context.database.findAppUser('lighttick',link.userId),user=await context.database.findUserById(link.userId);
   if(membership?.status!=='ACTIVE'||user?.status!=='ACTIVE')reject(403,'LightTick 账号不可用，请在客户端恢复访问。');
   if(data.action==='claim')result={binding_id:link.binding_id,target_user_id:link.userId,phase:link.phase};
   else if(data.action==='import')result=await runtime.actionLinks.import(source,data);
   else if(data.action==='request'){
    if(link.phase!=='active')reject(409,'计划正在接管，请稍后重试。');
    result=await runtime.actions.request(link,text(data.method,8,true),text(data.path,300),data.body??{},object(data.query??{}));
   }else reject(422,'联动操作无效。');
  }
 }else {
  const auth=await context.authenticateProductRequest(r,'lighttick'),owner:LightTickOwner={appId:'lighttick',userId:auth.userId};
  if(runtime.guestIdentity&&await runtime.guestIdentity.getActive(auth.userId))reject(403,'请先登录正式账户后使用共享计划。');
  if(r.path==='/api/v1/lighttick/action-link-tickets'){
   if(r.method!=='POST')reject(405,'请使用 POST 创建连接码。');result=await runtime.actionLinks.ticket(owner);
  }else result=await runtime.actions.request(owner,r.method,r.path.slice(prefix.length),data,r.query??{});
 }
 return context.ok(result,r.requestId as string,{'Cache-Control':'no-store'});
}

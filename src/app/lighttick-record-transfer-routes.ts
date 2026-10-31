import type {BackendRouteContext} from './backend-route-context.ts';
import type {LightTickRuntime} from '../modules/lighttick/lighttick-runtime.ts';
import type {HttpRequest,HttpResponse} from '../shared/types.ts';
import {RecordTransferService} from '../modules/lighttick/records/record-transfer.service.ts';
import {ApplicationError} from '../shared/errors.ts';
const prefix='/api/v1/lighttick/record-link';
export async function tryHandleRecordTransferRoutes(context:BackendRouteContext,enabled:boolean,runtime:LightTickRuntime|undefined,r:HttpRequest):Promise<HttpResponse<unknown>|undefined>{
 if(r.path!=='/api/v1/lighttick/record-bridge'&&r.path!==prefix&&!r.path.startsWith(prefix+'/'))return undefined;
 if(!enabled||!runtime?.recordHandoffEnabled)throw new ApplicationError(503,'LIGHTTICK_RECORD_HANDOFF_DISABLED','Record handoff is unavailable.');
 const authorize=async(owner:{appId:string;userId:string})=>{
  const membership=await context.database.findAppUser(owner.appId,owner.userId),user=await context.database.findUserById(owner.userId);
  if(membership?.status!=='ACTIVE'||user?.status!=='ACTIVE'||await runtime.guestIdentity?.getActive(owner.userId))throw new ApplicationError(403,'AUTH_ACCESS_DENIED','An active registered LightTick account is required.');
 };
 const service=new RecordTransferService(runtime.repository,runtime.recordTransfers.configuration,undefined,authorize);
 let result:unknown;
 if(r.path==='/api/v1/lighttick/record-bridge'){
  if(r.method!=='POST')throw new ApplicationError(405,'REQ_METHOD_INVALID','POST required.');
  if(!r.body||typeof r.body!=='object'||Array.isArray(r.body)||Buffer.byteLength(JSON.stringify(r.body))>5*1024*1024)throw new ApplicationError(413,'REQ_INVALID_BODY','Invalid handoff body.');
  result=await service.bridge({instance:r.headers['x-grow-instance']??'',subject:r.headers['x-grow-account-id']??''},r.headers,r.body as Record<string,unknown>);
 }else{
  const auth=await context.authenticateProductRequest(r,'lighttick'),owner={appId:'lighttick' as const,userId:auth.userId};await authorize(owner);
  if(r.path===prefix+'/tickets'&&r.method==='POST')result=await service.ticket(owner);
  else if(r.path===prefix+'/status'&&r.method==='GET')result=await service.status(owner);
  else if(r.path===prefix+'/readonly'&&r.method==='POST')result=await service.setReadonly(owner);
  else throw new ApplicationError(404,'REQ_NOT_FOUND','Record handoff route was not found.');
 }
 return context.ok(result,r.requestId as string,{'Cache-Control':'no-store'});
}

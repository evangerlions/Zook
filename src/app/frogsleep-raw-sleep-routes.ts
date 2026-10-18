import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from './backend-route-context.ts';
import type { HttpRequest,HttpResponse } from '../shared/types.ts';
import { asBody,authenticateFrogSleepRequest,frogSleepOk } from './frogsleep-v1-common.ts';
import { personalWriteOptions,rejectPersonalOwner } from './frogsleep-personal-sync-routes.ts';
import { PersonalSyncService } from '../modules/frogsleep/personal-sync/personal-sync.service.ts';
import { rawSleepSession } from '../modules/frogsleep/personal-sync/raw-sleep-session.ts';
import { parsePaginationParams } from '../modules/frogsleep/frogsleep-validation.ts';
import { badRequest } from '../shared/errors.ts';
export async function tryHandleRawSleepRoutes(context:BackendRouteContext,request:HttpRequest):Promise<HttpResponse<unknown>|undefined> {
  const match=request.path.match(/^\/v1\/product-data\/sleep-sessions(?:\/([^/]+))?$/);
  if(!match) return undefined;
  const auth=await authenticateFrogSleepRequest(context,request),service=new PersonalSyncService(context.getPersonalSyncRepository());
  let id: string | undefined;
  try { id=match[1]?decodeURIComponent(match[1]):undefined; }
  catch { badRequest('REQ_INVALID_BODY','Invalid encoded session ID.'); }
  if(request.method==='GET') {
    const params=parsePaginationParams(request.query);
    return frogSleepOk(context,id?{sleep_session:await service.get(auth.userId,'sleep_session',id)}:await service.page(auth.userId,'restore',params.limit,params.cursor,'sleep_session'),request.requestId!);
  }
  if(request.method!=='POST'&&request.method!=='PUT'&&request.method!=='PATCH'&&request.method!=='DELETE') return undefined;
  if(request.method==='POST'&&id||request.method!=='POST'&&!id) return undefined;
  const options=personalWriteOptions(request);
  if(!options.epoch||!options.operationKey) badRequest('REQ_INVALID_HEADER','X-Sync-Epoch and Idempotency-Key are required.');
  if(request.method==='DELETE') return frogSleepOk(context,{sleep_session:await service.write(auth.userId,'sleep_session',id!,{},true,options)},request.requestId!);
  const body=asBody(request);rejectPersonalOwner(body,auth.userId);
  context.requireValidPublicContract(PublicContractValidator.validateFrogSleepRawSleepSessionRequest(body),request);
  const payload=rawSleepSession(body);
  if(id&&id!==payload.session_id) badRequest('REQ_INVALID_BODY','Path ID and session_id must match.');
  return frogSleepOk(context,{sleep_session:await service.write(auth.userId,'sleep_session',String(payload.session_id),payload,false,options)},request.requestId!);
}

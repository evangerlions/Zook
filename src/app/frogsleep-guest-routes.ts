import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from './backend-route-context.ts';
import type { HttpRequest,HttpResponse } from '../shared/types.ts';
import { asBody,authenticateFrogSleepRequest,frogSleepOk,toFrogSleepAuthPayload } from './frogsleep-v1-common.ts';
import { SleepGuestService } from '../modules/frogsleep/guest/sleep-guest.service.ts';
import { guestHash } from '../modules/frogsleep/guest/guest-validation.ts';
import { getHeader } from '../shared/utils.ts';
import { ApplicationError } from '../shared/errors.ts';
export async function tryHandleSleepGuestRoutes(context:BackendRouteContext,request:HttpRequest):Promise<HttpResponse<unknown>|undefined> {
  if(request.method!=='POST')return undefined;
  const body=asBody(request);
  if(request.path!=='/v1/account/guest-sessions'&&!(request.path==='/v1/account/upgrade'&&('guest_user_id'in body||'guest_upgrade_token'in body))) return undefined;
  const service=new SleepGuestService(context.database,context.appRegistryService);
  if(request.path==='/v1/account/guest-sessions') {
    context.appContextResolver.resolvePostAuth(request,'frogsleep');
    const explicit=context.appContextResolver.extractExplicitAppId(request);
    if(explicit)context.appAccessGuard.assertScope('frogsleep',explicit);
    // Shared atomic counter: bounded anonymous account/session issuance across workers.
    const rateKey=guestHash(request.ipAddress??'unknown')+':'+Math.floor(Date.now()/3600000);
    await context.kvManager.incrementCounters('frogsleep.guest-rate',rateKey,{requests:1},3600);
    if((await context.kvManager.getCounters('frogsleep.guest-rate',rateKey)).requests>30) throw new ApplicationError(429,'FROGSLEEP_GUEST_RATE_LIMITED','Too many guest session requests.');
    context.requireValidPublicContract(PublicContractValidator.validateFrogSleepGuestSessionRequest(body),request);
    const identity=await service.create(body,getHeader(request.headers,'idempotency-key'));
    const session=await context.authService.issueSession(identity.guest_user_id,'frogsleep');
    return frogSleepOk(context,{...await toFrogSleepAuthPayload(context,session),...identity},request.requestId!);
  }
  const auth=await authenticateFrogSleepRequest(context,request);
  context.requireValidPublicContract(PublicContractValidator.validateFrogSleepGuestUpgradeRequest(body),request);
  const result=await service.upgrade(auth.userId,body,getHeader(request.headers,'idempotency-key'),getHeader(request.headers,'x-sync-epoch'));
  // The SQL membership is already revoked. Exact receipt replay retries failed KV cleanup.
  await context.authService.revokeAllSessions('frogsleep',result.previous_guest_user_id);
  return frogSleepOk(context,result,request.requestId!);
}

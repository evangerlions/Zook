import { ApplicationError } from '../shared/errors.ts';
import type { HttpRequest } from '../shared/types.ts';
import type { LightTickOwner } from '../modules/lighttick/lighttick.types.ts';
import type { LightTickRepository } from '../modules/lighttick/lighttick.repository.ts';
import { LightTickRecordService } from '../modules/lighttick/lighttick-record.service.ts';

// Shared LightTick auth and guest capability checks MUST run before this handler.
export async function handleRecordRequest(repository:LightTickRepository,owner:LightTickOwner,request:HttpRequest,authorize:(owner:LightTickOwner)=>Promise<void>=async()=>{}) {
 const service=new LightTickRecordService(repository,undefined,authorize); const prefix='/api/v1/lighttick/records';
 if(request.path===prefix+'/export'&&request.method==='GET') return service.export(owner);
 if(request.path===prefix&&request.method==='GET') return service.list(owner,request.query as Record<string,string>);
 const match=request.path.match(/^\/api\/v1\/lighttick\/records\/([a-zA-Z0-9_-]+)(?:\/(versions|archive|restore))?$/);
 if(!match) return undefined;
 if(request.method==='GET'&&!match[2]) return service.get(owner,match[1]!);
 if(request.method==='GET'&&match[2]==='versions') return service.versions(owner,match[1]!);
 if((request.method==='PUT'&&!match[2])||(request.method==='POST'&&['archive','restore'].includes(match[2]!))) {
  if(!request.body||typeof request.body!=='object'||Array.isArray(request.body)) throw new ApplicationError(400,'REQ_INVALID_BODY','Object body required.');
  return service.mutate(owner,match[1]!,match[2] as 'archive'|'restore'??'save',request.body as Record<string,unknown>,request.headers['idempotency-key']??request.headers['Idempotency-Key']??'');
 }
 return undefined;
}

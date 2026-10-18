import type { ApplicationDatabase } from '../../../infrastructure/database/application-database.ts';
import type { UserRecord,HttpRequest } from '../../../shared/types.ts';
import { ApplicationError,forbidden } from '../../../shared/errors.ts';
/** Enforced centrally so a normal bearer token cannot give a guest platform capabilities. */
export async function assertSleepGuestActive(db:ApplicationDatabase,user:UserRecord,appId:string,now=new Date()) {
  if(user.passwordAlgo!=='frogsleep-guest') return;
  const identity=await db.getSleepGuestStore().find(user.id);
  if(appId!=='frogsleep'||!identity||identity.upgradedTo||Date.parse(identity.expiresAt)<=now.getTime()||(await db.findAppUser('frogsleep',user.id))?.status!=='ACTIVE') throw new ApplicationError(401,'FROGSLEEP_GUEST_SESSION_INVALID','Guest session is expired or unavailable.');
}
export async function assertSleepGuestRequest(db:ApplicationDatabase,user:UserRecord,appId:string,request:HttpRequest) {
  if(user.passwordAlgo!=='frogsleep-guest')return;
  await assertSleepGuestActive(db,user,appId);
  const path=request.path.replace(/^\/api\/v1\/frogsleep(?=\/|$)/,'/v1');
  const privateSync=/^\/v1\/product-data\/(?:sleep-sessions(?:\/[^/]+)?|sleep-reports(?:\/[^/]+)?|personal-sync\/(?:state|restore|changes)|progress\/report_preferences)$/.test(path);
  const session=request.method==='GET'&&path==='/v1/me'||request.method==='POST'&&['/v1/auth/logout','/api/v1/auth/logout'].includes(path)||request.method==='DELETE'&&path==='/v1/me/account';
  if(!privateSync&&!session) forbidden('FROGSLEEP_GUEST_SCOPE_FORBIDDEN','Guest sessions can only access private Sleep sync and their session.');
}

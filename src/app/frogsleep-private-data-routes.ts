import type { BackendRouteContext } from './backend-route-context.ts';
import type { HttpRequest,HttpResponse } from '../shared/types.ts';
import { tryHandleSleepGuestRoutes } from './frogsleep-guest-routes.ts';
import { tryHandleRawSleepRoutes } from './frogsleep-raw-sleep-routes.ts';
import { tryHandlePersonalSyncRoutes } from './frogsleep-personal-sync-routes.ts';
/** Keep private data dispatch separate from the legacy buddy route registry. */
export async function tryHandlePrivateSleepData(context:BackendRouteContext,request:HttpRequest):Promise<HttpResponse<unknown>|undefined> {
  return await tryHandleSleepGuestRoutes(context,request)
    ?? await tryHandleRawSleepRoutes(context,request)
    ?? await tryHandlePersonalSyncRoutes(context,request);
}

/** These endpoints commit/roll back in their resource service before HTTP error conversion. */
export function ownsPrivateSleepTransaction(request: HttpRequest): boolean {
  const prefix = '/api/v1/frogsleep';
  if (!request.path.startsWith(prefix + '/')) return false;
  const suffix = request.path.slice(prefix.length);
  if (request.method === 'POST' && /^\/account\/(guest-sessions|upgrade)$/.test(suffix)) return true;
  if (request.method === 'GET' && /^\/product-data\/personal-sync\/(state|restore|changes)$/.test(suffix)) return true;
  if (['GET','POST','PUT','PATCH','DELETE'].includes(request.method) && /^\/product-data\/sleep-(sessions|reports)(?:\/[^/]+)?$/.test(suffix)) return true;
  return ['GET','PUT','PATCH','DELETE'].includes(request.method) && suffix === '/product-data/progress/report_preferences';
}

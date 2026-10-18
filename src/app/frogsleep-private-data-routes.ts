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

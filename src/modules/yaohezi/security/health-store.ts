import type { YaoheziAccountScope } from "../profiles/yaohezi-profile-store.ts";
/** All authorization and its protected effect share one durable transaction. No in-memory fallback. */
export interface YaoheziHealthStore {
  handle(action: string, account: YaoheziAccountScope, body: unknown, sessionToken?: string): Promise<unknown>;
}

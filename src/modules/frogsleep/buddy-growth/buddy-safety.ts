import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { forbidden } from "../../../shared/errors.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Enforces bilateral buddy block state before relationship or interaction writes. */
export async function assertBuddyPairNotBlocked(
  database: ApplicationDatabase,
  userA: string,
  userB: string,
): Promise<void> {
  const [fromA, fromB] = await Promise.all([
    database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_match_feedback", ownerUserId: userA, partnerUserId: userB, status: "blocked", limit: 1 }),
    database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_match_feedback", ownerUserId: userB, partnerUserId: userA, status: "blocked", limit: 1 }),
  ]);
  if (fromA.length > 0 || fromB.length > 0) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Buddy interaction is unavailable.");
  }
}

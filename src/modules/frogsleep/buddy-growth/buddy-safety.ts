import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

/** Enforces bilateral buddy block state before relationship or interaction writes. */
export async function assertBuddyPairNotBlocked(
  database: ApplicationDatabase,
  userA: string,
  userB: string,
): Promise<void> {
  if (await isBuddyPairBlocked(database, userA, userB)) {
    forbidden("AUTH_APP_SCOPE_MISMATCH", "Buddy interaction is unavailable.");
  }
}

/** Returns whether either participant has blocked the other in the buddy safety domain. */
export async function isBuddyPairBlocked(
  database: ApplicationDatabase,
  userA: string,
  userB: string,
): Promise<boolean> {
  const [fromA, fromB] = await Promise.all([
    database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_match_feedback", ownerUserId: userA, partnerUserId: userB, status: "blocked", limit: 1 }),
    database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_match_feedback", ownerUserId: userB, partnerUserId: userA, status: "blocked", limit: 1 }),
  ]);
  return fromA.length > 0 || fromB.length > 0;
}

/** Records a bilateral block between two buddy users. Idempotent on existing active blocks. */
export async function recordBuddyBlock(
  database: ApplicationDatabase,
  blockerUserId: string,
  blockedUserId: string,
  input: { reason?: string; note?: string } = {},
): Promise<{ id: string; blocked_user_id: string; status: "blocked"; created_at: string }> {
  if (blockerUserId === blockedUserId) {
    badRequest("REQ_INVALID_BODY", "Cannot block yourself.");
  }
  // Idempotency: if an active block already exists from this blocker to this target, return it.
  const existing = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: blockerUserId,
    partnerUserId: blockedUserId,
    status: "blocked",
    limit: 1,
  });
  if (existing.length > 0) {
    const row = existing[0] as FrogSleepEntityRecord;
    return { id: row.id, blocked_user_id: blockedUserId, status: "blocked", created_at: row.createdAt };
  }
  const createdAt = new Date().toISOString();
  const record: FrogSleepEntityRecord = {
    id: randomId("focus_match_feedback"),
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: blockerUserId,
    partnerUserId: blockedUserId,
    status: "blocked",
    payload: { reason: input.reason, note: input.note },
    createdAt,
    updatedAt: createdAt,
  };
  await database.insertFrogSleepEntity(record);
  return { id: record.id, blocked_user_id: blockedUserId, status: "blocked", created_at: record.createdAt };
}

/** Removes an active block from blocker to blocked. Returns whether a block was removed. */
export async function revokeBuddyBlock(
  database: ApplicationDatabase,
  blockerUserId: string,
  blockedUserId: string,
): Promise<{ removed: boolean }> {
  const existing = await database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: blockerUserId,
    partnerUserId: blockedUserId,
    status: "blocked",
    limit: 1,
  });
  if (existing.length === 0) {
    return { removed: false };
  }
  const row = existing[0] as FrogSleepEntityRecord;
  await database.updateFrogSleepEntity("focus_match_feedback", FROGSLEEP_APP_ID, row.id, {
    status: "revoked",
    deletedAt: new Date().toISOString(),
  });
  return { removed: true };
}

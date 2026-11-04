import { normalizeFrogSleepBuddyCommandSlotKeys, type FrogSleepBuddyCommandSlotKey }
  from "../../../modules/frogsleep/buddy-growth/buddy-command-slot-keys.ts";

type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

/** Locks legacy accept commands on the same ordered slot rows as canonical commands, within their current transaction. */
export async function lockBuddySlots(query: Query, keys: FrogSleepBuddyCommandSlotKey[]) {
  const normalized = normalizeFrogSleepBuddyCommandSlotKeys(keys);
  for (const key of normalized) await query(
    `INSERT INTO zook_frogsleep_buddy_domain_slots (app_id,user_id,domain,state,version,created_at,updated_at)
     VALUES ($1,$2,$3,'available',1,NOW(),NOW()) ON CONFLICT (app_id,user_id,domain) DO NOTHING`,
    [key.appId, key.userId, key.domain]);
  for (const key of normalized) await query(
    `SELECT user_id FROM zook_frogsleep_buddy_domain_slots WHERE app_id=$1 AND user_id=$2 AND domain=$3 FOR UPDATE`,
    [key.appId, key.userId, key.domain]);
}

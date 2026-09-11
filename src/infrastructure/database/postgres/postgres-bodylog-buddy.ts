import type { Pool } from "pg";
import type {
  BuddyPairRecord,
  BuddyActivityRecord,
  BuddyEncouragementRecord,
} from "../../../modules/bodylog/bodylog-buddy.types.ts";

export async function insertBodyLogBuddyPair(pool: Pool, record: BuddyPairRecord): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_buddy_pairs (
      id, app_id, user_id, partner_user_id, shared_habit_ids, status,
      consecutive_days, max_consecutive, current_tier, last_active_date,
      revival_used_this_month, invited_via, invitation_token,
      created_at, accepted_at, dissolved_at, updated_at, inviter_user_id
    ) VALUES (
      $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18
    )`,
    [
      record.id,
      record.appId,
      record.userId,
      record.partnerUserId,
      JSON.stringify(record.sharedHabitIds),
      record.status,
      record.consecutiveDays,
      record.maxConsecutive,
      record.currentTier,
      record.lastActiveDate,
      record.revivalUsedThisMonth,
      record.invitedVia,
      record.invitationToken,
      record.createdAt,
      record.acceptedAt,
      record.dissolvedAt,
      record.updatedAt,
      record.inviterUserId,
    ],
  );
}

export async function findBodyLogBuddyPair(pool: Pool, pairId: string): Promise<BuddyPairRecord | undefined> {
  const result = await pool.query(
    `SELECT *, last_active_date::text AS last_active_date FROM zook_bodylog_buddy_pairs WHERE id = $1`,
    [pairId],
  );
  if (result.rows.length === 0) return undefined;
  return parseBuddyPairRow(result.rows[0]);
}

export async function updateBodyLogBuddyPair(pool: Pool, record: BuddyPairRecord): Promise<void> {
  await pool.query(
    `UPDATE zook_bodylog_buddy_pairs SET
      shared_habit_ids = $2::jsonb,
      status = $3,
      consecutive_days = $4,
      max_consecutive = $5,
      current_tier = $6,
      last_active_date = $7,
      revival_used_this_month = $8,
      invited_via = $9,
      invitation_token = $10,
      accepted_at = $11,
      dissolved_at = $12,
      updated_at = $13, inviter_user_id = $14, created_at = $15
    WHERE id = $1`,
    [
      record.id,
      JSON.stringify(record.sharedHabitIds),
      record.status,
      record.consecutiveDays,
      record.maxConsecutive,
      record.currentTier,
      record.lastActiveDate,
      record.revivalUsedThisMonth,
      record.invitedVia,
      record.invitationToken,
      record.acceptedAt,
      record.dissolvedAt,
      record.updatedAt,
      record.inviterUserId,
      record.createdAt,
    ],
  );
}

export async function listBodyLogBuddyPairsByUser(
  pool: Pool,
  appId: string,
  userId: string,
): Promise<BuddyPairRecord[]> {
  const result = await pool.query(
    `SELECT *, last_active_date::text AS last_active_date FROM zook_bodylog_buddy_pairs
     WHERE app_id = $1 AND (user_id = $2 OR partner_user_id = $2)
     ORDER BY created_at DESC`,
    [appId, userId],
  );
  return result.rows.map(parseBuddyPairRow);
}

export async function listAllBodyLogBuddyPairs(pool: Pool, appId: string): Promise<BuddyPairRecord[]> {
  const result = await pool.query(
    `SELECT *, last_active_date::text AS last_active_date FROM zook_bodylog_buddy_pairs WHERE app_id = $1 ORDER BY created_at DESC`,
    [appId],
  );
  return result.rows.map(parseBuddyPairRow);
}

export async function findBodyLogBuddyPairByUsers(
  pool: Pool,
  appId: string,
  userId: string,
  partnerUserId: string,
): Promise<BuddyPairRecord | undefined> {
  const result = await pool.query(
    `SELECT *, last_active_date::text AS last_active_date FROM zook_bodylog_buddy_pairs
     WHERE app_id = $1 AND user_id = $2 AND partner_user_id = $3`,
    [appId, userId, partnerUserId],
  );
  if (result.rows.length === 0) return undefined;
  return parseBuddyPairRow(result.rows[0]);
}

export async function insertBodyLogBuddyActivity(pool: Pool, record: BuddyActivityRecord): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_buddy_activities (
      id, pair_id, actor_user_id, type, target_habit_id, payload, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      record.id,
      record.pairId,
      record.actorUserId,
      record.type,
      record.targetHabitId,
      JSON.stringify(record.payload),
      record.createdAt,
    ],
  );
}

export async function listBodyLogBuddyActivities(pool: Pool, pairId: string): Promise<BuddyActivityRecord[]> {
  const result = await pool.query(
    `SELECT * FROM zook_bodylog_buddy_activities WHERE pair_id = $1 ORDER BY created_at DESC`,
    [pairId],
  );
  return result.rows.map(parseBuddyActivityRow);
}

export async function insertBodyLogBuddyEncouragement(
  pool: Pool,
  record: BuddyEncouragementRecord,
): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_buddy_encouragements (
      id, pair_id, from_user_id, to_user_id, emoji, is_same_action, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      record.id,
      record.pairId,
      record.fromUserId,
      record.toUserId,
      record.emoji,
      record.isSameAction,
      record.createdAt,
    ],
  );
}

export async function listBodyLogBuddyEncouragements(
  pool: Pool,
  pairId: string,
): Promise<BuddyEncouragementRecord[]> {
  const result = await pool.query(
    `SELECT * FROM zook_bodylog_buddy_encouragements WHERE pair_id = $1 ORDER BY created_at DESC`,
    [pairId],
  );
  return result.rows.map(parseBuddyEncouragementRow);
}

function parseBuddyPairRow(row: any): BuddyPairRecord {
  return {
    inviterUserId: row.inviter_user_id,
    id: row.id,
    appId: row.app_id,
    userId: row.user_id,
    partnerUserId: row.partner_user_id,
    sharedHabitIds: Array.isArray(row.shared_habit_ids)
      ? row.shared_habit_ids
      : JSON.parse(row.shared_habit_ids || "[]"),
    status: row.status,
    consecutiveDays: row.consecutive_days,
    maxConsecutive: row.max_consecutive,
    currentTier: row.current_tier,
    lastActiveDate: row.last_active_date ? row.last_active_date.toISOString?.() ?? row.last_active_date : null,
    revivalUsedThisMonth: row.revival_used_this_month,
    invitedVia: row.invited_via,
    invitationToken: row.invitation_token,
    createdAt: row.created_at.toISOString?.() ?? row.created_at,
    acceptedAt: row.accepted_at ? (row.accepted_at.toISOString?.() ?? row.accepted_at) : null,
    dissolvedAt: row.dissolved_at ? (row.dissolved_at.toISOString?.() ?? row.dissolved_at) : null,
    updatedAt: row.updated_at.toISOString?.() ?? row.updated_at,
  };
}

function parseBuddyActivityRow(row: any): BuddyActivityRecord {
  return {
    id: row.id,
    pairId: row.pair_id,
    actorUserId: row.actor_user_id,
    type: row.type,
    targetHabitId: row.target_habit_id,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    createdAt: row.created_at.toISOString?.() ?? row.created_at,
  };
}

function parseBuddyEncouragementRow(row: any): BuddyEncouragementRecord {
  return {
    id: row.id,
    pairId: row.pair_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    emoji: row.emoji,
    isSameAction: row.is_same_action,
    createdAt: row.created_at.toISOString?.() ?? row.created_at,
  };
}

import type { Pool } from "pg";
import type {
  CheckInGroupRecord,
  GroupMemberRecord,
  GroupDailyRecordRecord,
  GroupActivityRecord,
} from "../../../modules/bodylog/bodylog-group.types.ts";

export async function insertCheckInGroup(pool: Pool, record: CheckInGroupRecord): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_groups (
      id, app_id, name, icon, leader_user_id, shared_habit_ids, completion_rule,
      max_members, status, consecutive_days, max_consecutive, current_tier,
      last_active_date, created_at, updated_at, invitation_token
    ) VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
    )`,
    [
      record.id,
      record.appId,
      record.name,
      record.icon,
      record.leaderUserId,
      JSON.stringify(record.sharedHabitIds),
      record.completionRule,
      record.maxMembers,
      record.status,
      record.consecutiveDays,
      record.maxConsecutive,
      record.currentTier,
      record.lastActiveDate,
      record.createdAt,
      record.updatedAt,
      record.invitationToken,
    ],
  );
}

export async function findCheckInGroup(pool: Pool, groupId: string): Promise<CheckInGroupRecord | undefined> {
  const result = await pool.query(
    `SELECT *, last_active_date::text AS last_active_date FROM zook_bodylog_groups WHERE id = $1`,
    [groupId],
  );
  if (result.rows.length === 0) return undefined;
  return parseCheckInGroupRow(result.rows[0]);
}

export async function updateCheckInGroup(pool: Pool, record: CheckInGroupRecord): Promise<void> {
  await pool.query(
    `UPDATE zook_bodylog_groups SET
      name = $2, icon = $3, shared_habit_ids = $4::jsonb, completion_rule = $5,
      max_members = $6, status = $7, consecutive_days = $8, max_consecutive = $9,
      current_tier = $10, last_active_date = $11, updated_at = $12, leader_user_id = $13
    WHERE id = $1`,
    [
      record.id,
      record.name,
      record.icon,
      JSON.stringify(record.sharedHabitIds),
      record.completionRule,
      record.maxMembers,
      record.status,
      record.consecutiveDays,
      record.maxConsecutive,
      record.currentTier,
      record.lastActiveDate,
      record.updatedAt,
      record.leaderUserId,
    ],
  );
}

export async function listCheckInGroupsByUser(
  pool: Pool,
  appId: string,
  userId: string,
): Promise<CheckInGroupRecord[]> {
  const result = await pool.query(
    `SELECT g.*, g.last_active_date::text AS last_active_date FROM zook_bodylog_groups g
     JOIN zook_bodylog_group_members gm ON g.id = gm.group_id
     WHERE g.app_id = $1 AND gm.user_id = $2 AND gm.status = 'active'
     ORDER BY g.created_at DESC`,
    [appId, userId],
  );
  return result.rows.map(parseCheckInGroupRow);
}

export async function listAllCheckInGroups(pool: Pool, appId: string): Promise<CheckInGroupRecord[]> {
  const result = await pool.query(
    `SELECT *, last_active_date::text AS last_active_date FROM zook_bodylog_groups WHERE app_id = $1 ORDER BY created_at DESC`,
    [appId],
  );
  return result.rows.map(parseCheckInGroupRow);
}

export async function insertGroupMember(pool: Pool, record: GroupMemberRecord): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_group_members (
      id, group_id, user_id, role, joined_at, invitation_token, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      record.id,
      record.groupId,
      record.userId,
      record.role,
      record.joinedAt,
      record.invitationToken,
      record.status,
    ],
  );
}

export async function findGroupMember(
  pool: Pool,
  groupId: string,
  userId: string,
): Promise<GroupMemberRecord | undefined> {
  const result = await pool.query(
    `SELECT * FROM zook_bodylog_group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  if (result.rows.length === 0) return undefined;
  return parseGroupMemberRow(result.rows[0]);
}

export async function updateGroupMember(pool: Pool, record: GroupMemberRecord): Promise<void> {
  await pool.query(
    `UPDATE zook_bodylog_group_members SET
      role = $2, invitation_token = $3, status = $4, joined_at = $5
    WHERE id = $1`,
    [
      record.id,
      record.role,
      record.invitationToken,
      record.status,
      record.joinedAt,
    ],
  );
}

export async function listGroupMembers(pool: Pool, groupId: string): Promise<GroupMemberRecord[]> {
  const result = await pool.query(
    `SELECT * FROM zook_bodylog_group_members WHERE group_id = $1 ORDER BY joined_at`,
    [groupId],
  );
  return result.rows.map(parseGroupMemberRow);
}

export async function insertGroupDailyRecord(pool: Pool, record: GroupDailyRecordRecord): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_group_daily_records (
      id, group_id, date, completed_user_ids, total_members, completed_count,
      completion_rate, created_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
    [
      record.id,
      record.groupId,
      record.date,
      JSON.stringify(record.completedUserIds),
      record.totalMembers,
      record.completedCount,
      record.completionRate,
      record.createdAt,
    ],
  );
}

export async function findGroupDailyRecord(
  pool: Pool,
  groupId: string,
  date: string,
): Promise<GroupDailyRecordRecord | undefined> {
  const result = await pool.query(
    `SELECT *, date::text AS date FROM zook_bodylog_group_daily_records WHERE group_id = $1 AND date = $2`,
    [groupId, date],
  );
  if (result.rows.length === 0) return undefined;
  return parseGroupDailyRecordRow(result.rows[0]);
}

export async function updateGroupDailyRecord(pool: Pool, record: GroupDailyRecordRecord): Promise<void> {
  await pool.query(
    `UPDATE zook_bodylog_group_daily_records SET
      completed_user_ids = $2::jsonb, completed_count = $3, completion_rate = $4
    WHERE id = $1`,
    [
      record.id,
      JSON.stringify(record.completedUserIds),
      record.completedCount,
      record.completionRate,
    ],
  );
}

export async function listGroupDailyRecordsSince(
  pool: Pool,
  groupId: string,
  date: string,
): Promise<GroupDailyRecordRecord[]> {
  const result = await pool.query(
    `SELECT *, date::text AS date FROM zook_bodylog_group_daily_records
     WHERE group_id = $1 AND date >= $2
     ORDER BY date DESC`,
    [groupId, date],
  );
  return result.rows.map(parseGroupDailyRecordRow);
}

export async function insertGroupActivity(pool: Pool, record: GroupActivityRecord): Promise<void> {
  await pool.query(
    `INSERT INTO zook_bodylog_group_activities (
      id, group_id, actor_user_id, type, target_habit_id, payload, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      record.id,
      record.groupId,
      record.actorUserId,
      record.type,
      record.targetHabitId,
      JSON.stringify(record.payload),
      record.createdAt,
    ],
  );
}

export async function listGroupActivities(
  pool: Pool,
  groupId: string,
  limit = 50,
): Promise<GroupActivityRecord[]> {
  const result = await pool.query(
    `SELECT * FROM zook_bodylog_group_activities
     WHERE group_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [groupId, limit],
  );
  return result.rows.map(parseGroupActivityRow);
}

function parseCheckInGroupRow(row: any): CheckInGroupRecord {
  return {
    invitationToken: row.invitation_token,
    id: row.id,
    appId: row.app_id,
    name: row.name,
    icon: row.icon,
    leaderUserId: row.leader_user_id,
    sharedHabitIds: Array.isArray(row.shared_habit_ids)
      ? row.shared_habit_ids
      : JSON.parse(row.shared_habit_ids || "[]"),
    completionRule: row.completion_rule,
    maxMembers: row.max_members,
    status: row.status,
    consecutiveDays: row.consecutive_days,
    maxConsecutive: row.max_consecutive,
    currentTier: row.current_tier,
    lastActiveDate: row.last_active_date ? row.last_active_date.toISOString?.() ?? row.last_active_date : null,
    createdAt: row.created_at.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at.toISOString?.() ?? row.updated_at,
  };
}

function parseGroupMemberRow(row: any): GroupMemberRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at.toISOString?.() ?? row.joined_at,
    invitationToken: row.invitation_token,
    status: row.status,
  };
}

function parseGroupDailyRecordRow(row: any): GroupDailyRecordRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    date: row.date instanceof Date ? row.date.toISOString().split("T")[0] : row.date,
    completedUserIds: Array.isArray(row.completed_user_ids)
      ? row.completed_user_ids
      : JSON.parse(row.completed_user_ids || "[]"),
    totalMembers: row.total_members,
    completedCount: row.completed_count,
    completionRate: parseFloat(row.completion_rate),
    createdAt: row.created_at.toISOString?.() ?? row.created_at,
  };
}

function parseGroupActivityRow(row: any): GroupActivityRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    actorUserId: row.actor_user_id,
    type: row.type,
    targetHabitId: row.target_habit_id,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    createdAt: row.created_at.toISOString?.() ?? row.created_at,
  };
}

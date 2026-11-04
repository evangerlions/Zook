import type { Pool } from "pg";
import type { GroupMemberRecord } from "../../../modules/bodylog/bodylog-group.types.ts";

/** Serialize both per-user quota and the last group slot across all accept routes. */
export async function activateGroupMember(pool: Pool, record: GroupMemberRecord, token: string, groupLimit: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`bodylog-group-user:${record.userId}`]);
    const { rows: [group] } = await client.query("SELECT * FROM zook_bodylog_groups WHERE id=$1 FOR UPDATE", [record.groupId]);
    const { rows: [member] } = await client.query("SELECT * FROM zook_bodylog_group_members WHERE group_id=$1 AND user_id=$2 FOR UPDATE", [record.groupId, record.userId]);
    let result: "joined" | "alreadyMember" | "full" | "limit" | "invalid" = "invalid";
    const shared = group?.invitation_token === token;
    const invitedAt = shared ? group?.created_at : member?.joined_at;
    if (group?.status === "active" && member?.status === "active") result = "alreadyMember";
    else if (group?.status === "active" && (!member || member.status === "pending") &&
        (shared || member?.invitation_token === token) && invitedAt && Date.now() - new Date(invitedAt).getTime() <= 7 * 86400000) {
      const { rows: [count] } = await client.query("SELECT count(*)::int AS n FROM zook_bodylog_group_members WHERE group_id=$1 AND status='active'", [record.groupId]);
      const { rows: [quota] } = await client.query("SELECT count(*)::int AS n FROM zook_bodylog_group_members m JOIN zook_bodylog_groups g ON g.id=m.group_id WHERE m.user_id=$1 AND m.status='active' AND g.app_id=$2 AND g.status='active'", [record.userId, group.app_id]);
      if (count.n >= group.max_members) result = "full";
      else if (quota.n >= groupLimit) result = "limit";
      else {
        await client.query(`INSERT INTO zook_bodylog_group_members(id,group_id,user_id,role,joined_at,invitation_token,status)
          VALUES($1,$2,$3,$4,$5,$6,'active') ON CONFLICT(group_id,user_id) DO UPDATE SET status='active',invitation_token=$6`,
          [record.id, record.groupId, record.userId, record.role, record.joinedAt, record.invitationToken]);
        result = "joined";
      }
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

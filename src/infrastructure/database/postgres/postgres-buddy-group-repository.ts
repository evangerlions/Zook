import type {
  FrogSleepBuddyGroupInvitationRecord,
  FrogSleepBuddyGroupMemberRecord,
  FrogSleepBuddyGroupRecord,
} from "../../../shared/types.ts";

/** PostgreSQL persistence adapter for FrogSleep buddy groups. */
export class PostgresBuddyGroupRepository {
  constructor(private readonly pool: { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> }) {}

  async insertGroup(record: FrogSleepBuddyGroupRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_groups
       (id, app_id, domain, group_name, group_description, owner_user_id, status, member_count,
        sharing_baseline, version, dissolved_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [record.id, record.appId, record.domain, record.groupName, record.groupDescription, record.ownerUserId,
        record.status, record.memberCount, record.sharingBaseline, record.version, record.dissolvedAt,
        record.createdAt, record.updatedAt],
    );
    if (result.rows[0]) return mapGroup(result.rows[0]);
    const existing = await this.findGroup(record.appId, record.id);
    if (!existing) throw new Error("FrogSleep buddy group ID collision.");
    return existing;
  }

  async findGroup(appId: string, groupId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_groups WHERE app_id=$1 AND id=$2`,
      [appId, groupId],
    );
    return result.rows[0] ? mapGroup(result.rows[0]) : undefined;
  }

  async listGroupsForUser(appId: string, userId: string) {
    const result = await this.pool.query(
      `SELECT g.* FROM zook_frogsleep_buddy_groups g
       INNER JOIN zook_frogsleep_buddy_group_members m
         ON m.app_id = g.app_id AND m.group_id = g.id AND m.user_id = $2 AND m.status = 'active'
       WHERE g.app_id = $1 AND g.status IN ('forming','active','paused')
       ORDER BY g.updated_at DESC, g.id DESC`,
      [appId, userId],
    );
    return result.rows.map(mapGroup);
  }

  async listGroupsForOwner(appId: string, ownerUserId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_groups
       WHERE app_id=$1 AND owner_user_id=$2 AND status IN ('forming','active','paused')
       ORDER BY updated_at DESC, id DESC`,
      [appId, ownerUserId],
    );
    return result.rows.map(mapGroup);
  }

  async compareAndUpdateGroup(input: {
    appId: string; id: string; expectedVersion: number;
    status: FrogSleepBuddyGroupRecord["status"]; memberCount: number;
    sharingBaseline: string[]; dissolvedAt?: string; updatedAt: string;
    groupName?: string; groupDescription?: string; groupDescriptionSpecified?: boolean;
  }) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_groups
       SET status=$4, member_count=$5, sharing_baseline=$6, dissolved_at=$7,
           version=version+1, updated_at=$8,
           group_name=COALESCE($9, group_name),
           group_description=CASE WHEN $10 THEN $11 ELSE group_description END
       WHERE app_id=$1 AND id=$2 AND version=$3 RETURNING *`,
      [input.appId, input.id, input.expectedVersion, input.status, input.memberCount,
        input.sharingBaseline, input.dissolvedAt, input.updatedAt, input.groupName ?? null,
        Boolean(input.groupDescriptionSpecified), input.groupDescription ?? null],
    );
    return result.rows[0] ? mapGroup(result.rows[0]) : undefined;
  }

  async insertGroupMember(record: FrogSleepBuddyGroupMemberRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_group_members
       (id, app_id, group_id, user_id, role, status, version, joined_at, left_at, invited_at, invite_expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (app_id, group_id, user_id) DO UPDATE SET
         role=EXCLUDED.role, status=EXCLUDED.status, joined_at=COALESCE(EXCLUDED.joined_at, zook_frogsleep_buddy_group_members.joined_at),
         left_at=EXCLUDED.left_at, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.id, record.appId, record.groupId, record.userId, record.role, record.status, record.version,
        record.joinedAt, record.leftAt, record.invitedAt, record.inviteExpiresAt,
        record.createdAt, record.updatedAt],
    );
    return mapGroupMember(result.rows[0]);
  }

  async findGroupMember(appId: string, groupId: string, userId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_group_members
       WHERE app_id=$1 AND group_id=$2 AND user_id=$3`,
      [appId, groupId, userId],
    );
    return result.rows[0] ? mapGroupMember(result.rows[0]) : undefined;
  }

  async listGroupMembers(appId: string, groupId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_group_members
       WHERE app_id=$1 AND group_id=$2 ORDER BY joined_at ASC NULLS LAST, id ASC`,
      [appId, groupId],
    );
    return result.rows.map(mapGroupMember);
  }

  async compareAndUpdateGroupMember(input: {
    appId: string; groupId: string; userId: string; expectedVersion: number;
    role: FrogSleepBuddyGroupMemberRecord["role"];
    status: FrogSleepBuddyGroupMemberRecord["status"];
    leftAt?: string; updatedAt: string;
  }) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_group_members
       SET role=$5, status=$6, left_at=$7, updated_at=$8, version=version+1
       WHERE app_id=$1 AND group_id=$2 AND user_id=$3 AND version=$4 RETURNING *`,
      [input.appId, input.groupId, input.userId, input.expectedVersion, input.role, input.status,
        input.leftAt, input.updatedAt],
    );
    return result.rows[0] ? mapGroupMember(result.rows[0]) : undefined;
  }

  async insertGroupInvitation(record: FrogSleepBuddyGroupInvitationRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_group_invitations
       (id, app_id, group_id, inviter_user_id, invitee_user_id, invitee_email, status, version, expires_at, responded_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [record.id, record.appId, record.groupId, record.inviterUserId, record.inviteeUserId,
        record.inviteeEmail, record.status, record.version, record.expiresAt, record.respondedAt,
        record.createdAt, record.updatedAt],
    );
    if (result.rows[0]) return mapGroupInvitation(result.rows[0]);
    const existing = await this.findGroupInvitation(record.appId, record.id);
    if (!existing) throw new Error("FrogSleep buddy group invitation ID collision.");
    return existing;
  }

  async findGroupInvitation(appId: string, invitationId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_group_invitations WHERE app_id=$1 AND id=$2`,
      [appId, invitationId],
    );
    return result.rows[0] ? mapGroupInvitation(result.rows[0]) : undefined;
  }

  async listGroupInvitations(appId: string, groupId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_group_invitations
       WHERE app_id=$1 AND group_id=$2 ORDER BY created_at DESC, id DESC`,
      [appId, groupId],
    );
    return result.rows.map(mapGroupInvitation);
  }

  async compareAndUpdateGroupInvitation(input: {
    appId: string; invitationId: string; expectedVersion: number;
    status: FrogSleepBuddyGroupInvitationRecord["status"];
    respondedAt?: string; updatedAt: string;
  }) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_group_invitations
       SET status=$4, responded_at=$5, updated_at=$6, version=version+1
       WHERE app_id=$1 AND id=$2 AND version=$3 RETURNING *`,
      [input.appId, input.invitationId, input.expectedVersion, input.status,
        input.respondedAt, input.updatedAt],
    );
    return result.rows[0] ? mapGroupInvitation(result.rows[0]) : undefined;
  }
}

const iso = (value: Date | string | null | undefined) => value instanceof Date ? value.toISOString() : value ?? undefined;
const mapGroup = (row: any): FrogSleepBuddyGroupRecord => ({ id: row.id, appId: row.app_id, domain: row.domain, groupName: row.group_name, groupDescription: row.group_description ?? undefined, ownerUserId: row.owner_user_id, status: row.status, memberCount: Number(row.member_count), sharingBaseline: row.sharing_baseline ?? [], version: row.version, dissolvedAt: iso(row.dissolved_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapGroupMember = (row: any): FrogSleepBuddyGroupMemberRecord => ({ id: row.id, appId: row.app_id, groupId: row.group_id, userId: row.user_id, role: row.role, status: row.status, joinedAt: iso(row.joined_at), leftAt: iso(row.left_at), invitedAt: iso(row.invited_at), inviteExpiresAt: iso(row.invite_expires_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapGroupInvitation = (row: any): FrogSleepBuddyGroupInvitationRecord => ({ id: row.id, appId: row.app_id, groupId: row.group_id, inviterUserId: row.inviter_user_id, inviteeUserId: row.invitee_user_id ?? undefined, inviteeEmail: row.invitee_email ?? undefined, status: row.status, expiresAt: iso(row.expires_at)!, respondedAt: iso(row.responded_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });

import type {
  BodyLogInvitationAttributionRecord,
  BodyLogInvitationRecord,
} from "../../../modules/bodylog/bodylog-invitation.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

export class PostgresBodyLogInvitationStore {
  constructor(private readonly query: Query) {}

  async findByTokenHash(appId: string, tokenHash: string) {
    const result = await this.query(
      `SELECT id, app_id, inviter_user_id, inviter_install_id_hash, token_hash, expires_at, created_at
       FROM zook_bodylog_invitations WHERE app_id = $1 AND token_hash = $2`,
      [appId, tokenHash],
    );
    return result.rows[0] ? invitation(result.rows[0]) : undefined;
  }

  async insertInvitation(record: BodyLogInvitationRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_invitations
       (id, app_id, inviter_user_id, inviter_install_id_hash, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)`,
      [record.id, record.appId, record.inviterUserId, record.inviterInstallIdHash, record.tokenHash,
        record.expiresAt, record.createdAt],
    );
  }

  async listInvitations(appId: string, inviterUserId: string) {
    const result = await this.query(
      `SELECT id, app_id, inviter_user_id, inviter_install_id_hash, token_hash, expires_at, created_at
       FROM zook_bodylog_invitations WHERE app_id = $1 AND inviter_user_id = $2`,
      [appId, inviterUserId],
    );
    return result.rows.map(invitation);
  }

  async insertAttribution(record: BodyLogInvitationAttributionRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_invitation_attributions
       (id, app_id, invitation_id, inviter_user_id, invitee_user_id, install_id_hash,
        completed_dates, attributed_at, qualified_at, rewarded_at,
        inviter_reward_ends_at, invitee_reward_ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz,
        $9::timestamptz, $10::timestamptz, $11::timestamptz, $12::timestamptz)`,
      values(record),
    );
  }

  async updateAttribution(record: BodyLogInvitationAttributionRecord) {
    await this.query(
      `UPDATE zook_bodylog_invitation_attributions SET completed_dates = $2::jsonb,
       qualified_at = $3::timestamptz, rewarded_at = $4::timestamptz,
       inviter_reward_ends_at = $5::timestamptz, invitee_reward_ends_at = $6::timestamptz
       WHERE id = $1`,
      [record.id, JSON.stringify(record.completedDates), record.qualifiedAt ?? null,
        record.rewardedAt ?? null, record.inviterRewardEndsAt ?? null,
        record.inviteeRewardEndsAt ?? null],
    );
  }

  async listAttributions(appId: string) {
    const result = await this.query(
      `SELECT id, app_id, invitation_id, inviter_user_id, invitee_user_id,
       install_id_hash, completed_dates, attributed_at, qualified_at, rewarded_at,
       inviter_reward_ends_at, invitee_reward_ends_at
       FROM zook_bodylog_invitation_attributions WHERE app_id = $1`,
      [appId],
    );
    return result.rows.map(attribution);
  }
}

function invitation(row: Record<string, unknown>): BodyLogInvitationRecord {
  return {
    id: String(row.id), appId: String(row.app_id),
    inviterUserId: String(row.inviter_user_id),
    inviterInstallIdHash: String(row.inviter_install_id_hash),
    tokenHash: String(row.token_hash),
    expiresAt: iso(row.expires_at), createdAt: iso(row.created_at),
  };
}

function attribution(row: Record<string, unknown>): BodyLogInvitationAttributionRecord {
  return {
    id: String(row.id), appId: String(row.app_id),
    invitationId: String(row.invitation_id), inviterUserId: String(row.inviter_user_id),
    inviteeUserId: String(row.invitee_user_id), installIdHash: String(row.install_id_hash),
    completedDates: row.completed_dates as string[], attributedAt: iso(row.attributed_at),
    qualifiedAt: row.qualified_at ? iso(row.qualified_at) : undefined,
    rewardedAt: row.rewarded_at ? iso(row.rewarded_at) : undefined,
    inviterRewardEndsAt: row.inviter_reward_ends_at ? iso(row.inviter_reward_ends_at) : undefined,
    inviteeRewardEndsAt: row.invitee_reward_ends_at ? iso(row.invitee_reward_ends_at) : undefined,
  };
}

function values(record: BodyLogInvitationAttributionRecord): unknown[] {
  return [
    record.id, record.appId, record.invitationId, record.inviterUserId,
    record.inviteeUserId, record.installIdHash, JSON.stringify(record.completedDates),
    record.attributedAt, record.qualifiedAt ?? null, record.rewardedAt ?? null,
    record.inviterRewardEndsAt ?? null, record.inviteeRewardEndsAt ?? null,
  ];
}

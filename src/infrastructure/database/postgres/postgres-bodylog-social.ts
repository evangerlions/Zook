import type {
  BodyLogBlockRecord,
  BodyLogFriendRequestRecord,
  BodyLogFriendshipRecord,
  BodyLogReportRecord,
} from "../../../modules/bodylog/bodylog-social.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

export class PostgresBodyLogSocialStore {
  constructor(private readonly query: Query) {}

  async listFriendRequests(appId: string): Promise<BodyLogFriendRequestRecord[]> {
    const result = await this.query(
      "SELECT id, app_id, sender_user_id, recipient_user_id, status, created_at, updated_at FROM zook_bodylog_friend_requests WHERE app_id = $1",
      [appId],
    );
    return result.rows.map((row) => ({
      id: String(row.id), appId: String(row.app_id),
      senderUserId: String(row.sender_user_id), recipientUserId: String(row.recipient_user_id),
      status: String(row.status) as BodyLogFriendRequestRecord["status"],
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }));
  }

  async upsertFriendRequest(record: BodyLogFriendRequestRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_friend_requests
       (id, app_id, sender_user_id, recipient_user_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      [record.id, record.appId, record.senderUserId, record.recipientUserId,
        record.status, record.createdAt, record.updatedAt],
    );
    return record;
  }

  async listFriendships(appId: string): Promise<BodyLogFriendshipRecord[]> {
    const result = await this.query(
      "SELECT app_id, user_id, friend_user_id, created_at FROM zook_bodylog_friendships WHERE app_id = $1",
      [appId],
    );
    return result.rows.map((row) => ({
      appId: String(row.app_id), userId: String(row.user_id),
      friendUserId: String(row.friend_user_id), createdAt: iso(row.created_at),
    }));
  }

  async insertFriendship(record: BodyLogFriendshipRecord) {
    const [userId, friendUserId] = [record.userId, record.friendUserId].sort();
    await this.query(
      `INSERT INTO zook_bodylog_friendships (app_id, user_id, friend_user_id, created_at)
       VALUES ($1, $2, $3, $4::timestamptz) ON CONFLICT DO NOTHING`,
      [record.appId, userId, friendUserId, record.createdAt],
    );
  }

  async deleteFriendship(appId: string, userId: string, friendUserId: string) {
    await this.query(
      `DELETE FROM zook_bodylog_friendships WHERE app_id = $1 AND
       ((user_id = $2 AND friend_user_id = $3) OR (user_id = $3 AND friend_user_id = $2))`,
      [appId, userId, friendUserId],
    );
  }

  async listBlocks(appId: string): Promise<BodyLogBlockRecord[]> {
    const result = await this.query(
      "SELECT app_id, blocker_user_id, blocked_user_id, created_at FROM zook_bodylog_blocks WHERE app_id = $1",
      [appId],
    );
    return result.rows.map((row) => ({
      appId: String(row.app_id), blockerUserId: String(row.blocker_user_id),
      blockedUserId: String(row.blocked_user_id), createdAt: iso(row.created_at),
    }));
  }

  async insertBlock(record: BodyLogBlockRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_blocks (app_id, blocker_user_id, blocked_user_id, created_at)
       VALUES ($1, $2, $3, $4::timestamptz) ON CONFLICT DO NOTHING`,
      [record.appId, record.blockerUserId, record.blockedUserId, record.createdAt],
    );
  }

  async deleteBlock(appId: string, blockerUserId: string, blockedUserId: string) {
    await this.query(
      "DELETE FROM zook_bodylog_blocks WHERE app_id = $1 AND blocker_user_id = $2 AND blocked_user_id = $3",
      [appId, blockerUserId, blockedUserId],
    );
  }

  async insertReport(record: BodyLogReportRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_reports
       (id, app_id, reporter_user_id, reported_user_id, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [record.id, record.appId, record.reporterUserId, record.reportedUserId,
        record.reason, record.createdAt],
    );
  }

  async listReports(appId: string, reporterUserId: string): Promise<BodyLogReportRecord[]> {
    const result = await this.query(
      `SELECT id, app_id, reporter_user_id, reported_user_id, reason, created_at
       FROM zook_bodylog_reports WHERE app_id = $1 AND reporter_user_id = $2`,
      [appId, reporterUserId],
    );
    return result.rows.map((row) => ({
      id: String(row.id), appId: String(row.app_id),
      reporterUserId: String(row.reporter_user_id), reportedUserId: String(row.reported_user_id),
      reason: String(row.reason) as BodyLogReportRecord["reason"], createdAt: iso(row.created_at),
    }));
  }
}

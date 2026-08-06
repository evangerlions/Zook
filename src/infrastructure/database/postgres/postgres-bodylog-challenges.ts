import type {
  BodyLogChallengeMemberRecord,
  BodyLogChallengeRecord,
} from "../../../modules/bodylog/bodylog-challenge.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);

export class PostgresBodyLogChallengeStore {
  constructor(private readonly query: Query) {}

  async insertChallenge(record: BodyLogChallengeRecord) {
    await this.query(
      `INSERT INTO zook_bodylog_challenges
       (id, app_id, creator_user_id, theme_key, timezone, status, start_date,
        end_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date,
        $9::timestamptz, $10::timestamptz)`,
      challengeValues(record),
    );
  }

  async updateChallenge(record: BodyLogChallengeRecord) {
    await this.query(
      `UPDATE zook_bodylog_challenges SET status = $2, start_date = $3::date,
       end_date = $4::date, updated_at = $5::timestamptz WHERE id = $1`,
      [record.id, record.status, record.startDate ?? null, record.endDate ?? null,
        record.updatedAt],
    );
  }

  async listChallenges(appId: string) {
    const result = await this.query(
      `SELECT id, app_id, creator_user_id, theme_key, timezone, status,
       start_date, end_date, created_at, updated_at
       FROM zook_bodylog_challenges WHERE app_id = $1`,
      [appId],
    );
    return result.rows.map(challenge);
  }

  async insertMembers(records: BodyLogChallengeMemberRecord[]) {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_bodylog_challenge_members
         (app_id, challenge_id, user_id, status, completed_dates, joined_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
        memberValues(record),
      );
    }
  }

  async updateMember(record: BodyLogChallengeMemberRecord) {
    await this.query(
      `UPDATE zook_bodylog_challenge_members SET status = $3,
       completed_dates = $4::jsonb, joined_at = $5::timestamptz,
       updated_at = $6::timestamptz WHERE challenge_id = $1 AND user_id = $2`,
      [record.challengeId, record.userId, record.status,
        JSON.stringify(record.completedDates), record.joinedAt ?? null, record.updatedAt],
    );
  }

  async listMembers(appId: string) {
    const result = await this.query(
      `SELECT app_id, challenge_id, user_id, status, completed_dates, joined_at, updated_at
       FROM zook_bodylog_challenge_members WHERE app_id = $1`,
      [appId],
    );
    return result.rows.map(member);
  }
}

function challenge(row: Record<string, unknown>): BodyLogChallengeRecord {
  return {
    id: String(row.id), appId: String(row.app_id),
    creatorUserId: String(row.creator_user_id),
    themeKey: String(row.theme_key) as BodyLogChallengeRecord["themeKey"],
    timezone: String(row.timezone),
    status: String(row.status) as BodyLogChallengeRecord["status"],
    startDate: row.start_date ? iso(row.start_date).slice(0, 10) : undefined,
    endDate: row.end_date ? iso(row.end_date).slice(0, 10) : undefined,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function member(row: Record<string, unknown>): BodyLogChallengeMemberRecord {
  return {
    appId: String(row.app_id), challengeId: String(row.challenge_id),
    userId: String(row.user_id),
    status: String(row.status) as BodyLogChallengeMemberRecord["status"],
    completedDates: row.completed_dates as string[],
    joinedAt: row.joined_at ? iso(row.joined_at) : undefined,
    updatedAt: iso(row.updated_at),
  };
}

function challengeValues(record: BodyLogChallengeRecord): unknown[] {
  return [
    record.id, record.appId, record.creatorUserId, record.themeKey,
    record.timezone, record.status, record.startDate ?? null, record.endDate ?? null,
    record.createdAt, record.updatedAt,
  ];
}

function memberValues(record: BodyLogChallengeMemberRecord): unknown[] {
  return [
    record.appId, record.challengeId, record.userId, record.status,
    JSON.stringify(record.completedDates), record.joinedAt ?? null, record.updatedAt,
  ];
}

import type { BodyLogProfileRecord } from "../../../modules/bodylog/bodylog-profile.types.ts";
export type { BodyLogProfileRecord } from "../../../modules/bodylog/bodylog-profile.types.ts";

type Query = (
  sql: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

function parseBodyLogProfile(
  row: Record<string, unknown>,
): BodyLogProfileRecord {
  return {
    appId: String(row.app_id),
    userId: String(row.user_id),
    nickname: String(row.nickname),
    avatarKey: String(row.avatar_key) as BodyLogProfileRecord["avatarKey"],
    profileCompleted: Boolean(row.profile_completed),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function findPostgresBodyLogProfile(
  query: Query,
  appId: string,
  userId: string,
): Promise<BodyLogProfileRecord | undefined> {
  const result = await query(
    `SELECT app_id, user_id, nickname, avatar_key, profile_completed,
            created_at, updated_at
     FROM zook_bodylog_profiles
     WHERE app_id = $1 AND user_id = $2
     LIMIT 1`,
    [appId, userId],
  );
  return result.rows[0] ? parseBodyLogProfile(result.rows[0]) : undefined;
}

export async function upsertPostgresBodyLogProfile(
  query: Query,
  record: BodyLogProfileRecord,
): Promise<BodyLogProfileRecord> {
  const result = await query(
    `INSERT INTO zook_bodylog_profiles (
       app_id, user_id, nickname, avatar_key, profile_completed,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
     ON CONFLICT (app_id, user_id) DO UPDATE SET
       nickname = EXCLUDED.nickname,
       avatar_key = EXCLUDED.avatar_key,
       profile_completed = EXCLUDED.profile_completed,
       updated_at = EXCLUDED.updated_at
     RETURNING app_id, user_id, nickname, avatar_key, profile_completed,
               created_at, updated_at`,
    [
      record.appId,
      record.userId,
      record.nickname,
      record.avatarKey,
      record.profileCompleted,
      record.createdAt,
      record.updatedAt,
    ],
  );
  return parseBodyLogProfile(result.rows[0] as Record<string, unknown>);
}

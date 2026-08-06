import type { QueryResult, QueryResultRow } from "pg";
import type { AppUserRecord } from "../../../shared/types.ts";
import { parseAppUser } from "./postgres-row-parsers.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

const APP_USER_COLUMNS =
  "id, app_id, user_id, status, account_region, joined_at";

export class PostgresAppUserStore {
  constructor(private readonly query: PostgresQuery) {}

  async list(appId?: string): Promise<AppUserRecord[]> {
    const result = appId
      ? await this.query(
          `SELECT ${APP_USER_COLUMNS} FROM zook_app_users WHERE app_id = $1 ORDER BY joined_at ASC`,
          [appId],
        )
      : await this.query(
          `SELECT ${APP_USER_COLUMNS} FROM zook_app_users ORDER BY joined_at ASC`,
        );
    return result.rows.map(parseAppUser);
  }

  async find(appId: string, userId: string): Promise<AppUserRecord | undefined> {
    const result = await this.query(
      `SELECT ${APP_USER_COLUMNS} FROM zook_app_users WHERE app_id = $1 AND user_id = $2 LIMIT 1`,
      [appId, userId],
    );
    return result.rows[0] ? parseAppUser(result.rows[0]) : undefined;
  }

  async insert(record: AppUserRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_app_users (id, app_id, user_id, status, account_region, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.appId,
        record.userId,
        record.status,
        record.accountRegion,
        record.joinedAt,
      ],
    );
  }

  async updateStatus(
    appId: string,
    userId: string,
    status: AppUserRecord["status"],
  ): Promise<AppUserRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_app_users
       SET status = $3, updated_at = NOW()
       WHERE app_id = $1 AND user_id = $2
       RETURNING ${APP_USER_COLUMNS}`,
      [appId, userId, status],
    );
    return result.rows[0] ? parseAppUser(result.rows[0]) : undefined;
  }

  async finalizeAccountRegion(
    appId: string,
    userId: string,
    accountRegion: Exclude<AppUserRecord["accountRegion"], "UNKNOWN">,
  ): Promise<AppUserRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_app_users
       SET account_region = $3, updated_at = NOW()
       WHERE app_id = $1 AND user_id = $2 AND account_region = 'UNKNOWN'
       RETURNING ${APP_USER_COLUMNS}`,
      [appId, userId, accountRegion],
    );
    return result.rows[0] ? parseAppUser(result.rows[0]) : undefined;
  }
}

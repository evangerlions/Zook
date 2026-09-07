import type { Pool, PoolClient } from "pg";
import type {
  NotificationPreferencesRecord,
  UpdateNotificationPreferencesInput,
  PushDeviceRecord,
} from "../../../modules/bodylog/bodylog-notification.types.ts";
import { DEFAULT_CATEGORIES } from "../../../modules/bodylog/bodylog-notification.types.ts";

export class PostgresBodyLogNotificationStore {
  constructor(private readonly query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>) {}

  async findPreferences(userId: string): Promise<NotificationPreferencesRecord | null> {
    const result = await this.query(
      `SELECT * FROM bodylog_notification_preferences WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ? this.mapPreferencesRecord(result.rows[0]) : null;
  }

  async upsertPreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferencesRecord> {
    const existing = await this.findPreferences(userId);

    const enabledCategories = input.enabledCategories ?? existing?.enabledCategories ?? [...DEFAULT_CATEGORIES];
    const quietHoursEnabled = input.quietHours?.isEnabled ?? existing?.quietHoursEnabled ?? false;
    const quietHoursStart = input.quietHours?.startHour ?? existing?.quietHoursStart ?? 22;
    const quietHoursEnd = input.quietHours?.endHour ?? existing?.quietHoursEnd ?? 7;
    const mergeRequests = input.mergeRequests ?? existing?.mergeRequests ?? true;
    const leaderboardRankPush = input.leaderboardRankPush ?? existing?.leaderboardRankPush ?? false;
    const marketingConsent = input.marketingConsent ?? existing?.marketingConsent ?? false;

    const result = await this.query(
      `INSERT INTO bodylog_notification_preferences (
        user_id, enabled_categories, quiet_hours_enabled, quiet_hours_start,
        quiet_hours_end, merge_requests, leaderboard_rank_push, marketing_consent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        enabled_categories = $2,
        quiet_hours_enabled = $3,
        quiet_hours_start = $4,
        quiet_hours_end = $5,
        merge_requests = $6,
        leaderboard_rank_push = $7,
        marketing_consent = $8,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        JSON.stringify(enabledCategories),
        quietHoursEnabled,
        quietHoursStart,
        quietHoursEnd,
        mergeRequests,
        leaderboardRankPush,
        marketingConsent,
      ],
    );

    return this.mapPreferencesRecord(result.rows[0]);
  }

  async upsertDevice(
    userId: string,
    deviceToken: string,
    platform: "ios" | "android",
    name: string,
  ): Promise<PushDeviceRecord> {
    const result = await this.query(
      `INSERT INTO bodylog_push_devices (user_id, device_token, platform, name, last_seen_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (device_token) DO UPDATE SET
        user_id = $1,
        platform = $3,
        name = $4,
        last_seen_at = NOW()
      RETURNING *`,
      [userId, deviceToken, platform, name],
    );
    return this.mapDeviceRecord(result.rows[0]);
  }

  async listDevices(userId: string): Promise<PushDeviceRecord[]> {
    const result = await this.query(
      `SELECT * FROM bodylog_push_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [userId],
    );
    return result.rows.map((r: any) => this.mapDeviceRecord(r));
  }

  async findDevice(deviceId: string): Promise<PushDeviceRecord | null> {
    const result = await this.query(
      `SELECT * FROM bodylog_push_devices WHERE id = $1`,
      [deviceId],
    );
    return result.rows[0] ? this.mapDeviceRecord(result.rows[0]) : null;
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.query(`DELETE FROM bodylog_push_devices WHERE id = $1`, [deviceId]);
  }

  private mapPreferencesRecord(row: any): NotificationPreferencesRecord {
    return {
      id: row.id,
      userId: row.user_id,
      enabledCategories: typeof row.enabled_categories === "string"
        ? JSON.parse(row.enabled_categories)
        : row.enabled_categories,
      quietHoursEnabled: row.quiet_hours_enabled,
      quietHoursStart: row.quiet_hours_start,
      quietHoursEnd: row.quiet_hours_end,
      mergeRequests: row.merge_requests,
      leaderboardRankPush: row.leaderboard_rank_push,
      marketingConsent: row.marketing_consent,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDeviceRecord(row: any): PushDeviceRecord {
    return {
      id: row.id,
      userId: row.user_id,
      deviceToken: row.device_token,
      platform: row.platform,
      name: row.name,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    };
  }
}

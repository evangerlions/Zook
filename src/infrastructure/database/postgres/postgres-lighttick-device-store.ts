import type {
  LightTickOwner,
  LightTickDeviceRow,
} from "../../../modules/lighttick/lighttick.types.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
import type { QueryResult } from "./postgres-lighttick-owner-transaction.ts";
export class PostgresLightTickDeviceStore {
  constructor(
    private readonly query: (
      sql: string,
      args?: unknown[],
    ) => Promise<QueryResult>,
  ) {}
  async upsertDevice(row: LightTickDeviceRow): Promise<LightTickDeviceRow> {
    const result = await this.query(
      `INSERT INTO zook_lighttick_devices
      (id,app_id,user_id,platform,push_provider,push_token,timezone,locale,app_version,notifications_enabled,active,deleted_at,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (app_id,user_id,id) DO UPDATE SET platform=EXCLUDED.platform,push_provider=EXCLUDED.push_provider,
      push_token=EXCLUDED.push_token,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,app_version=EXCLUDED.app_version,
      notifications_enabled=EXCLUDED.notifications_enabled,active=EXCLUDED.active,deleted_at=EXCLUDED.deleted_at,updated_at=EXCLUDED.updated_at RETURNING *`,
      [
        row.id,
        row.appId,
        row.userId,
        row.platform,
        row.pushProvider,
        row.pushToken,
        row.timezone,
        row.locale,
        row.appVersion,
        row.notificationsEnabled,
        row.active,
        row.deletedAt ?? null,
        row.createdAt,
        row.updatedAt,
      ],
    );
    return mapRow<LightTickDeviceRow>(result.rows[0]!);
  }
  async listDevices(owner: LightTickOwner): Promise<LightTickDeviceRow[]> {
    const result = await this.query(
      `SELECT * FROM zook_lighttick_devices WHERE app_id=$1 AND user_id=$2 ORDER BY created_at ASC`,
      [owner.appId, owner.userId],
    );
    return result.rows.map(mapRow<LightTickDeviceRow>);
  }
  async deleteDevice(
    owner: LightTickOwner,
    id: string,
    deletedAt: string,
  ): Promise<boolean> {
    const result = await this.query(
      `UPDATE zook_lighttick_devices SET active=FALSE,deleted_at=$1,updated_at=$1
      WHERE app_id=$2 AND user_id=$3 AND id=$4 AND active=TRUE`,
      [deletedAt, owner.appId, owner.userId, id],
    );
    return Boolean(result.rowCount);
  }
}

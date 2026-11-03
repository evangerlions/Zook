import type { QueryResultRow } from "pg";
import type { AppConfigRecord, AppNameI18n, AppRecord, RolePermissionRecord } from "../../../shared/types.ts";
import { deletePostgresApp } from "./postgres-app-delete.ts";
import { parseApp, parseAppConfig, parseRolePermission } from "./postgres-row-parsers.ts";

type PostgresQuery = (sql: string, values?: unknown[]) => Promise<{ rows: QueryResultRow[] }>;

export class PostgresAppRegistryStore {
  constructor(private readonly query: PostgresQuery) {}

  async listApps(): Promise<AppRecord[]> {
    const result = await this.query("SELECT id, code, name, name_i18n, status, api_domain, join_mode, created_at FROM zook_apps ORDER BY id ASC");
    return result.rows.map(parseApp);
  }
  async listAppIds(): Promise<string[]> {
    const result = await this.query("SELECT id FROM zook_apps ORDER BY id ASC");
    return result.rows.map((row) => String(row.id));
  }
  async findApp(appId: string): Promise<AppRecord | undefined> {
    const result = await this.query(
      "SELECT id, code, name, name_i18n, status, api_domain, join_mode, created_at FROM zook_apps WHERE id = $1 OR code = $1 LIMIT 1",
      [appId],
    );
    return result.rows[0] ? parseApp(result.rows[0]) : undefined;
  }
  async findAppByApiDomain(hostname: string): Promise<AppRecord | undefined> {
    const result = await this.query(
      "SELECT id, code, name, name_i18n, status, api_domain, join_mode, created_at FROM zook_apps WHERE lower(api_domain) = lower($1) LIMIT 1",
      [hostname],
    );
    return result.rows[0] ? parseApp(result.rows[0]) : undefined;
  }
  async insertApp(record: AppRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_apps (id, code, name, name_i18n, status, api_domain, join_mode, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         name_i18n = EXCLUDED.name_i18n,
         status = EXCLUDED.status,
         api_domain = EXCLUDED.api_domain,
         join_mode = EXCLUDED.join_mode,
         created_at = EXCLUDED.created_at,
         updated_at = NOW()`,
      [record.id, record.code, record.name, JSON.stringify(record.nameI18n), record.status, record.apiDomain ?? null, record.joinMode, record.createdAt],
    );
  }
  async updateAppNames(appId: string, name: string, nameI18n: AppNameI18n): Promise<void> {
    await this.query(
      "UPDATE zook_apps SET name = $2, name_i18n = $3::jsonb, updated_at = NOW() WHERE id = $1",
      [appId, name, JSON.stringify(nameI18n)],
    );
  }
  async deleteApp(appId: string): Promise<void> {
    await deletePostgresApp(async (sql, values) => await this.query(sql, values), appId);
  }
  async listAppConfigs(appId?: string): Promise<AppConfigRecord[]> {
    const result = appId
      ? await this.query("SELECT id, app_id, config_key, config_value, updated_at FROM zook_app_configs WHERE app_id = $1 ORDER BY config_key ASC", [appId])
      : await this.query("SELECT id, app_id, config_key, config_value, updated_at FROM zook_app_configs ORDER BY app_id ASC, config_key ASC");
    return result.rows.map(parseAppConfig);
  }

  async findAppConfig(appId: string, configKey: string): Promise<AppConfigRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, config_key, config_value, updated_at FROM zook_app_configs WHERE app_id = $1 AND config_key = $2 LIMIT 1",
      [appId, configKey],
    );
    return result.rows[0] ? parseAppConfig(result.rows[0]) : undefined;
  }

  async upsertAppConfig(record: AppConfigRecord): Promise<AppConfigRecord> {
    const result = await this.query(
      `INSERT INTO zook_app_configs (id, app_id, config_key, config_value, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (app_id, config_key)
       DO UPDATE SET
         id = EXCLUDED.id,
         config_value = EXCLUDED.config_value,
         updated_at = EXCLUDED.updated_at
       RETURNING id, app_id, config_key, config_value, updated_at`,
      [record.id, record.appId, record.configKey, record.configValue, record.updatedAt],
    );
    return parseAppConfig(result.rows[0]);
  }

  async deleteAppConfigsByApp(appId: string): Promise<void> {
    await this.query("DELETE FROM zook_app_configs WHERE app_id = $1", [appId]);
  }

  async listRolePermissions(): Promise<RolePermissionRecord[]> {
    const result = await this.query("SELECT id, role_id, permission_id FROM zook_role_permissions ORDER BY id ASC");
    return result.rows.map(parseRolePermission);
  }
}

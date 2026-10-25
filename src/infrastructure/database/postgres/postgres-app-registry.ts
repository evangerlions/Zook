import type {AppRecord,AppNameI18n,RolePermissionRecord} from "../../../shared/types.ts";
import {parseApp,parseRolePermission} from "./postgres-row-parsers.ts";
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>
export class PostgresAppRegistryStore {
 constructor(private readonly query:Query){}
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
 async listRolePermissions():Promise<RolePermissionRecord[]> {
  const result=await this.query("SELECT id, role_id, permission_id FROM zook_role_permissions ORDER BY id ASC");
  return result.rows.map(parseRolePermission);
 }
}

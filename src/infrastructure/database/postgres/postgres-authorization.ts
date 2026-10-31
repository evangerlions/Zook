import type { RoleRecord, PermissionRecord, RolePermissionRecord, UserRoleRecord } from "../../../shared/types.ts";
import { parseRole, parsePermission, parseUserRole } from "./postgres-row-parsers.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Role and permission queries share the caller's active transaction connection. */
export class PostgresAuthorizationStore {
  constructor(private readonly query: Query) {}
  async listRoles(appId?: string): Promise<RoleRecord[]> {
    const result = appId
      ? await this.query("SELECT id, app_id, code, name, status FROM zook_roles WHERE app_id = $1 ORDER BY id ASC", [appId])
      : await this.query("SELECT id, app_id, code, name, status FROM zook_roles ORDER BY id ASC");
    return result.rows.map(parseRole);
  }
  async findRole(appId: string, roleCode: string): Promise<RoleRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, code, name, status FROM zook_roles WHERE app_id = $1 AND code = $2 LIMIT 1",
      [appId, roleCode],
    );
    return result.rows[0] ? parseRole(result.rows[0]) : undefined;
  }
  async insertRoles(records: RoleRecord[]): Promise<void> {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_roles (id, app_id, code, name, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           app_id = EXCLUDED.app_id,
           code = EXCLUDED.code,
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [record.id, record.appId, record.code, record.name, record.status],
      );
    }
  }
  async listPermissions(): Promise<PermissionRecord[]> {
    const result = await this.query("SELECT id, code, name, status FROM zook_permissions ORDER BY id ASC");
    return result.rows.map(parsePermission);
  }
  async insertRolePermissions(records: RolePermissionRecord[]): Promise<void> {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_role_permissions (id, role_id, permission_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           role_id = EXCLUDED.role_id,
           permission_id = EXCLUDED.permission_id,
           updated_at = NOW()`,
        [record.id, record.roleId, record.permissionId],
      );
    }
  }
  async findUserRole(appId: string, userId: string, roleId: string): Promise<UserRoleRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, user_id, role_id FROM zook_user_roles WHERE app_id = $1 AND user_id = $2 AND role_id = $3 LIMIT 1",
      [appId, userId, roleId],
    );
    return result.rows[0] ? parseUserRole(result.rows[0]) : undefined;
  }
  async insertUserRole(record: UserRoleRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_user_roles (id, app_id, user_id, role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.appId, record.userId, record.roleId],
    );
  }
  async getPermissionCodes(appId: string, userId: string): Promise<string[]> {
    const result = await this.query(
      `SELECT DISTINCT p.code
       FROM zook_user_roles ur
       JOIN zook_role_permissions rp ON rp.role_id = ur.role_id
       JOIN zook_permissions p ON p.id = rp.permission_id
       WHERE ur.app_id = $1 AND ur.user_id = $2
       ORDER BY p.code ASC`,
      [appId, userId],
    );
    return result.rows.map((row) => String(row.code));
  }

}

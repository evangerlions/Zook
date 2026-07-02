import type {
  AppUserRecord,
  DatabaseSeed,
  SmsVerificationRecord,
  UserRecord,
} from "../../../shared/types.ts";

type PostgresQuery = (sql: string, values?: unknown[]) => Promise<unknown>;

export async function seedPostgresDefaults(
  seed: DatabaseSeed,
  operations: {
    query: PostgresQuery;
    insertUser(record: UserRecord): Promise<void>;
    insertAppUser(record: AppUserRecord): Promise<void>;
    insertSmsVerificationRecord(record: SmsVerificationRecord): Promise<void>;
  },
): Promise<void> {
  for (const record of seed.apps ?? []) {
    await operations.query(
      `INSERT INTO zook_apps (id, code, name, name_i18n, status, api_domain, join_mode, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.code, record.name, JSON.stringify(record.nameI18n), record.status, record.apiDomain ?? null, record.joinMode, record.createdAt],
    );
  }
  for (const record of seed.users ?? []) {
    await operations.insertUser(record);
  }
  for (const record of seed.appUsers ?? []) {
    await operations.insertAppUser(record);
  }
  for (const record of seed.roles ?? []) {
    await operations.query(
      `INSERT INTO zook_roles (id, app_id, code, name, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (app_id, code) DO NOTHING`,
      [record.id, record.appId, record.code, record.name, record.status],
    );
  }
  for (const record of seed.permissions ?? []) {
    await operations.query(
      `INSERT INTO zook_permissions (id, code, name, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.code, record.name, record.status],
    );
  }
  for (const record of seed.rolePermissions ?? []) {
    await operations.query(
      `INSERT INTO zook_role_permissions (id, role_id, permission_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.roleId, record.permissionId],
    );
  }
  for (const record of seed.userRoles ?? []) {
    await operations.query(
      `INSERT INTO zook_user_roles (id, app_id, user_id, role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.appId, record.userId, record.roleId],
    );
  }
  for (const record of seed.appConfigs ?? []) {
    await operations.query(
      `INSERT INTO zook_app_configs (id, app_id, config_key, config_value, updated_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (app_id, config_key) DO NOTHING`,
      [record.id, record.appId, record.configKey, record.configValue, record.updatedAt],
    );
  }
  for (const record of seed.smsVerificationRecords ?? []) {
    await operations.insertSmsVerificationRecord(record);
  }
}

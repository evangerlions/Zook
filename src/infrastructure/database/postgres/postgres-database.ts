import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  AnalyticsEventRecord,
  AppConfigRecord,
  AppNameI18n,
  AppRecord,
  AppUserRecord,
  AuditLogRecord,
  ClientLogLineRecord,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  DatabaseSeed,
  FailedEventRecord,
  FileRecord,
  NotificationJobRecord,
  PermissionRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
} from "../../../shared/types.ts";
import { ApplicationDatabase, type ManagedStateSnapshot } from "../application-database.ts";
import { runPostgresMigrations } from "./migrate.ts";

function toIsoString(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

function parseApp(row: QueryResultRow): AppRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    nameI18n: (row.name_i18n ?? {}) as AppNameI18n,
    status: row.status as AppRecord["status"],
    apiDomain: row.api_domain ?? undefined,
    joinMode: row.join_mode as AppRecord["joinMode"],
    createdAt: toIsoString(row.created_at) as string,
  };
}

function parseUser(row: QueryResultRow): UserRecord {
  return {
    id: String(row.id),
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    passwordHash: String(row.password_hash),
    passwordAlgo: String(row.password_algo),
    status: row.status as UserRecord["status"],
    createdAt: toIsoString(row.created_at) as string,
  };
}

function parseAppUser(row: QueryResultRow): AppUserRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    status: row.status as AppUserRecord["status"],
    joinedAt: toIsoString(row.joined_at) as string,
  };
}

function parseRole(row: QueryResultRow): RoleRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    code: String(row.code),
    name: String(row.name),
    status: row.status as RoleRecord["status"],
  };
}

function parsePermission(row: QueryResultRow): PermissionRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    status: row.status as PermissionRecord["status"],
  };
}

function parseRolePermission(row: QueryResultRow): RolePermissionRecord {
  return {
    id: String(row.id),
    roleId: String(row.role_id),
    permissionId: String(row.permission_id),
  };
}

function parseUserRole(row: QueryResultRow): UserRoleRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    roleId: String(row.role_id),
  };
}

function parseAuditLog(row: QueryResultRow): AuditLogRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    actorUserId: row.actor_user_id ?? undefined,
    action: String(row.action),
    resourceType: String(row.resource_type),
    resourceId: row.resource_id ?? undefined,
    resourceOwnerUserId: row.resource_owner_user_id ?? undefined,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: toIsoString(row.created_at) as string,
  };
}

function parseNotificationJob(row: QueryResultRow): NotificationJobRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    recipientUserId: String(row.recipient_user_id),
    channel: row.channel as NotificationJobRecord["channel"],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as NotificationJobRecord["status"],
    retryCount: Number(row.retry_count ?? 0),
  };
}

function parseFailedEvent(row: QueryResultRow): FailedEventRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    eventType: String(row.event_type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    errorMessage: String(row.error_message ?? ""),
    retryCount: Number(row.retry_count ?? 0),
    nextRetryAt: toIsoString(row.next_retry_at) as string,
    createdAt: toIsoString(row.created_at) as string,
  };
}

function parseAppConfig(row: QueryResultRow): AppConfigRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    configKey: String(row.config_key),
    configValue: String(row.config_value ?? ""),
    updatedAt: toIsoString(row.updated_at) as string,
  };
}

function parseAnalyticsEvent(row: QueryResultRow): AnalyticsEventRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: String(row.user_id),
    platform: row.platform as AnalyticsEventRecord["platform"],
    sessionId: String(row.session_id),
    pageKey: String(row.page_key),
    eventName: row.event_name as AnalyticsEventRecord["eventName"],
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? undefined : Number(row.duration_ms),
    occurredAt: toIsoString(row.occurred_at) as string,
    receivedAt: toIsoString(row.received_at) as string,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function parseFile(row: QueryResultRow): FileRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    ownerUserId: String(row.owner_user_id),
    storageKey: String(row.storage_key),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    status: row.status as FileRecord["status"],
    createdAt: toIsoString(row.created_at) as string,
  };
}

function parseClientLogUploadTask(row: QueryResultRow): ClientLogUploadTaskRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id),
    userId: row.user_id ?? undefined,
    keyId: String(row.key_id),
    fromTsMs: row.from_ts_ms === null || row.from_ts_ms === undefined ? undefined : Number(row.from_ts_ms),
    toTsMs: row.to_ts_ms === null || row.to_ts_ms === undefined ? undefined : Number(row.to_ts_ms),
    maxLines: row.max_lines === null || row.max_lines === undefined ? undefined : Number(row.max_lines),
    maxBytes: row.max_bytes === null || row.max_bytes === undefined ? undefined : Number(row.max_bytes),
    status: row.status as ClientLogUploadTaskRecord["status"],
    createdAt: toIsoString(row.created_at) as string,
    expiresAt: toIsoString(row.expires_at),
    uploadedAt: toIsoString(row.uploaded_at),
  };
}

export class PostgresDatabase extends ApplicationDatabase {
  private readonly sessionContext = new AsyncLocalStorage<PoolClient>();
  private initialized = false;

  private constructor(
    private readonly pool: Pool,
    private readonly seed: DatabaseSeed,
  ) {
    super();
  }

  static async create(
    connectionString: string,
    seed: DatabaseSeed = {},
    options: {
      migrationConnectionString?: string;
    } = {},
  ): Promise<PostgresDatabase> {
    await runPostgresMigrations({
      connectionString: options.migrationConnectionString?.trim() || connectionString,
      log: (message) => console.log(message),
    });
    const pool = new Pool({
      connectionString,
    });
    const database = new PostgresDatabase(pool, seed);
    await database.initialize();
    return database;
  }

  override async withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T> {
    const existingClient = this.sessionContext.getStore();
    if (existingClient) {
      return await fn();
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [20260403]);
      const result = await this.sessionContext.run(client, async () => await fn());
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  override async close(): Promise<void> {
    await this.pool.end();
  }

  override async exportManagedState(): Promise<ManagedStateSnapshot> {
    return {
      apps: await this.listApps(),
      roles: await this.listRoles(),
      rolePermissions: await this.listRolePermissions(),
      appConfigs: await this.listAppConfigs(),
    };
  }

  override async listApps(): Promise<AppRecord[]> {
    const result = await this.query("SELECT id, code, name, name_i18n, status, api_domain, join_mode, created_at FROM zook_apps ORDER BY id ASC");
    return result.rows.map(parseApp);
  }

  override async listAppIds(): Promise<string[]> {
    const result = await this.query("SELECT id FROM zook_apps ORDER BY id ASC");
    return result.rows.map((row) => String(row.id));
  }

  override async findApp(appId: string): Promise<AppRecord | undefined> {
    const result = await this.query(
      "SELECT id, code, name, name_i18n, status, api_domain, join_mode, created_at FROM zook_apps WHERE id = $1 OR code = $1 LIMIT 1",
      [appId],
    );
    return result.rows[0] ? parseApp(result.rows[0]) : undefined;
  }

  override async findAppByApiDomain(hostname: string): Promise<AppRecord | undefined> {
    const result = await this.query(
      "SELECT id, code, name, name_i18n, status, api_domain, join_mode, created_at FROM zook_apps WHERE lower(api_domain) = lower($1) LIMIT 1",
      [hostname],
    );
    return result.rows[0] ? parseApp(result.rows[0]) : undefined;
  }

  override async insertApp(record: AppRecord): Promise<void> {
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

  override async updateAppNames(appId: string, name: string, nameI18n: AppNameI18n): Promise<void> {
    await this.query(
      "UPDATE zook_apps SET name = $2, name_i18n = $3::jsonb, updated_at = NOW() WHERE id = $1",
      [appId, name, JSON.stringify(nameI18n)],
    );
  }

  override async deleteApp(appId: string): Promise<void> {
    const roleRows = await this.query("SELECT id FROM zook_roles WHERE app_id = $1", [appId]);
    const roleIds = roleRows.rows.map((row) => String(row.id));
    if (roleIds.length > 0) {
      await this.query("DELETE FROM zook_role_permissions WHERE role_id = ANY($1::text[])", [roleIds]);
    }

    await this.query("DELETE FROM zook_user_roles WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_app_users WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_roles WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_audit_logs WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_notification_jobs WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_failed_events WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_analytics_events WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_files WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_client_log_lines WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_client_log_uploads WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_client_log_upload_tasks WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_app_configs WHERE app_id = $1", [appId]);
    await this.query("DELETE FROM zook_apps WHERE id = $1", [appId]);
  }

  override async listAppUsers(appId?: string): Promise<AppUserRecord[]> {
    const result = appId
      ? await this.query("SELECT id, app_id, user_id, status, joined_at FROM zook_app_users WHERE app_id = $1 ORDER BY joined_at ASC", [appId])
      : await this.query("SELECT id, app_id, user_id, status, joined_at FROM zook_app_users ORDER BY joined_at ASC");
    return result.rows.map(parseAppUser);
  }

  override async findAppUser(appId: string, userId: string): Promise<AppUserRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, user_id, status, joined_at FROM zook_app_users WHERE app_id = $1 AND user_id = $2 LIMIT 1",
      [appId, userId],
    );
    return result.rows[0] ? parseAppUser(result.rows[0]) : undefined;
  }

  override async insertAppUser(record: AppUserRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_app_users (id, app_id, user_id, status, joined_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.appId, record.userId, record.status, record.joinedAt],
    );
  }

  override async listRoles(appId?: string): Promise<RoleRecord[]> {
    const result = appId
      ? await this.query("SELECT id, app_id, code, name, status FROM zook_roles WHERE app_id = $1 ORDER BY id ASC", [appId])
      : await this.query("SELECT id, app_id, code, name, status FROM zook_roles ORDER BY id ASC");
    return result.rows.map(parseRole);
  }

  override async findRole(appId: string, roleCode: string): Promise<RoleRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, code, name, status FROM zook_roles WHERE app_id = $1 AND code = $2 LIMIT 1",
      [appId, roleCode],
    );
    return result.rows[0] ? parseRole(result.rows[0]) : undefined;
  }

  override async insertRoles(records: RoleRecord[]): Promise<void> {
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

  override async listPermissions(): Promise<PermissionRecord[]> {
    const result = await this.query("SELECT id, code, name, status FROM zook_permissions ORDER BY id ASC");
    return result.rows.map(parsePermission);
  }

  override async insertRolePermissions(records: RolePermissionRecord[]): Promise<void> {
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

  override async findUserRole(appId: string, userId: string, roleId: string): Promise<UserRoleRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, user_id, role_id FROM zook_user_roles WHERE app_id = $1 AND user_id = $2 AND role_id = $3 LIMIT 1",
      [appId, userId, roleId],
    );
    return result.rows[0] ? parseUserRole(result.rows[0]) : undefined;
  }

  override async insertUserRole(record: UserRoleRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_user_roles (id, app_id, user_id, role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.appId, record.userId, record.roleId],
    );
  }

  override async getPermissionCodes(appId: string, userId: string): Promise<string[]> {
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

  override async findUserById(userId: string): Promise<UserRecord | undefined> {
    const result = await this.query(
      "SELECT id, email, phone, password_hash, password_algo, status, created_at FROM zook_users WHERE id = $1 LIMIT 1",
      [userId],
    );
    return result.rows[0] ? parseUser(result.rows[0]) : undefined;
  }

  override async findUserByAccount(account: string): Promise<UserRecord | undefined> {
    const normalized = account.trim().toLowerCase();
    const result = await this.query(
      `SELECT id, email, phone, password_hash, password_algo, status, created_at
       FROM zook_users
       WHERE lower(coalesce(email, '')) = $1 OR lower(coalesce(phone, '')) = $1
       LIMIT 1`,
      [normalized],
    );
    return result.rows[0] ? parseUser(result.rows[0]) : undefined;
  }

  override async insertUser(record: UserRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_users (id, email, phone, password_hash, password_algo, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         password_hash = EXCLUDED.password_hash,
         password_algo = EXCLUDED.password_algo,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at,
         updated_at = NOW()`,
      [record.id, record.email ?? null, record.phone ?? null, record.passwordHash, record.passwordAlgo, record.status, record.createdAt],
    );
  }

  override async updateUserPassword(userId: string, passwordHash: string, passwordAlgo: string): Promise<void> {
    await this.query(
      "UPDATE zook_users SET password_hash = $2, password_algo = $3, updated_at = NOW() WHERE id = $1",
      [userId, passwordHash, passwordAlgo],
    );
  }

  override async insertAuditLog(record: AuditLogRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_audit_logs (
         id, app_id, actor_user_id, action, resource_type, resource_id, resource_owner_user_id, payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)`,
      [
        record.id,
        record.appId,
        record.actorUserId ?? null,
        record.action,
        record.resourceType,
        record.resourceId ?? null,
        record.resourceOwnerUserId ?? null,
        JSON.stringify(record.payload ?? {}),
        record.createdAt,
      ],
    );
  }

  override async listAppConfigs(appId?: string): Promise<AppConfigRecord[]> {
    const result = appId
      ? await this.query("SELECT id, app_id, config_key, config_value, updated_at FROM zook_app_configs WHERE app_id = $1 ORDER BY config_key ASC", [appId])
      : await this.query("SELECT id, app_id, config_key, config_value, updated_at FROM zook_app_configs ORDER BY app_id ASC, config_key ASC");
    return result.rows.map(parseAppConfig);
  }

  override async findAppConfig(appId: string, configKey: string): Promise<AppConfigRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, config_key, config_value, updated_at FROM zook_app_configs WHERE app_id = $1 AND config_key = $2 LIMIT 1",
      [appId, configKey],
    );
    return result.rows[0] ? parseAppConfig(result.rows[0]) : undefined;
  }

  override async upsertAppConfig(record: AppConfigRecord): Promise<AppConfigRecord> {
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

  override async deleteAppConfigsByApp(appId: string): Promise<void> {
    await this.query("DELETE FROM zook_app_configs WHERE app_id = $1", [appId]);
  }

  override async insertAnalyticsEvents(records: AnalyticsEventRecord[]): Promise<void> {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_analytics_events (
           id, app_id, user_id, platform, session_id, page_key, event_name, duration_ms, occurred_at, received_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11::jsonb)`,
        [
          record.id,
          record.appId,
          record.userId,
          record.platform,
          record.sessionId,
          record.pageKey,
          record.eventName,
          record.durationMs ?? null,
          record.occurredAt,
          record.receivedAt,
          JSON.stringify(record.metadata ?? {}),
        ],
      );
    }
  }

  override async listAnalyticsEvents(appId: string): Promise<AnalyticsEventRecord[]> {
    const result = await this.query(
      `SELECT id, app_id, user_id, platform, session_id, page_key, event_name, duration_ms, occurred_at, received_at, metadata
       FROM zook_analytics_events
       WHERE app_id = $1
       ORDER BY occurred_at ASC`,
      [appId],
    );
    return result.rows.map(parseAnalyticsEvent);
  }

  override async insertFile(record: FileRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_files (id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
      [record.id, record.appId, record.ownerUserId, record.storageKey, record.mimeType, record.sizeBytes, record.status, record.createdAt],
    );
  }

  override async findFileByOwnerAndStorageKey(appId: string, ownerUserId: string, storageKey: string): Promise<FileRecord | undefined> {
    const result = await this.query(
      `SELECT id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at
       FROM zook_files
       WHERE app_id = $1 AND owner_user_id = $2 AND storage_key = $3
       LIMIT 1`,
      [appId, ownerUserId, storageKey],
    );
    return result.rows[0] ? parseFile(result.rows[0]) : undefined;
  }

  override async findFileByAppAndStorageKey(appId: string, storageKey: string): Promise<FileRecord | undefined> {
    const result = await this.query(
      `SELECT id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at
       FROM zook_files
       WHERE app_id = $1 AND storage_key = $2
       LIMIT 1`,
      [appId, storageKey],
    );
    return result.rows[0] ? parseFile(result.rows[0]) : undefined;
  }

  override async confirmFile(fileId: string, mimeType: string, sizeBytes: number): Promise<FileRecord | undefined> {
    const result = await this.query(
      `UPDATE zook_files
       SET status = 'CONFIRMED', mime_type = $2, size_bytes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, app_id, owner_user_id, storage_key, mime_type, size_bytes, status, created_at`,
      [fileId, mimeType, sizeBytes],
    );
    return result.rows[0] ? parseFile(result.rows[0]) : undefined;
  }

  override async insertNotificationJob(record: NotificationJobRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_notification_jobs (id, app_id, recipient_user_id, channel, payload, status, retry_count, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())`,
      [record.id, record.appId, record.recipientUserId, record.channel, JSON.stringify(record.payload ?? {}), record.status, record.retryCount],
    );
  }

  override async findNotificationJob(jobId: string): Promise<NotificationJobRecord | undefined> {
    const result = await this.query(
      "SELECT id, app_id, recipient_user_id, channel, payload, status, retry_count FROM zook_notification_jobs WHERE id = $1 LIMIT 1",
      [jobId],
    );
    return result.rows[0] ? parseNotificationJob(result.rows[0]) : undefined;
  }

  override async updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount">>,
  ): Promise<NotificationJobRecord | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [jobId];
    let index = 2;

    if (patch.status !== undefined) {
      fields.push(`status = $${index++}`);
      values.push(patch.status);
    }

    if (patch.retryCount !== undefined) {
      fields.push(`retry_count = $${index++}`);
      values.push(patch.retryCount);
    }

    if (fields.length === 0) {
      return this.findNotificationJob(jobId);
    }

    fields.push("updated_at = NOW()");
    const result = await this.query(
      `UPDATE zook_notification_jobs
       SET ${fields.join(", ")}
       WHERE id = $1
       RETURNING id, app_id, recipient_user_id, channel, payload, status, retry_count`,
      values,
    );
    return result.rows[0] ? parseNotificationJob(result.rows[0]) : undefined;
  }

  override async insertFailedEvent(record: FailedEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_failed_events (
         id, app_id, event_type, payload, error_message, retry_count, next_retry_at, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::timestamptz, $8::timestamptz)`,
      [record.id, record.appId, record.eventType, JSON.stringify(record.payload ?? {}), record.errorMessage, record.retryCount, record.nextRetryAt, record.createdAt],
    );
  }

  override async listFailedEvents(appId?: string): Promise<FailedEventRecord[]> {
    const result = appId
      ? await this.query(
          "SELECT id, app_id, event_type, payload, error_message, retry_count, next_retry_at, created_at FROM zook_failed_events WHERE app_id = $1 ORDER BY created_at ASC",
          [appId],
        )
      : await this.query(
          "SELECT id, app_id, event_type, payload, error_message, retry_count, next_retry_at, created_at FROM zook_failed_events ORDER BY created_at ASC",
        );
    return result.rows.map(parseFailedEvent);
  }

  override async deleteFailedEvent(eventId: string): Promise<void> {
    await this.query("DELETE FROM zook_failed_events WHERE id = $1", [eventId]);
  }

  override async updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): Promise<void> {
    await this.query(
      `UPDATE zook_failed_events
       SET retry_count = $2, error_message = $3, next_retry_at = $4::timestamptz, updated_at = NOW()
       WHERE id = $1`,
      [eventId, patch.retryCount, patch.errorMessage, patch.nextRetryAt],
    );
  }

  override async listClientLogUploadTasks(appId?: string): Promise<ClientLogUploadTaskRecord[]> {
    const result = appId
      ? await this.query(
          `SELECT id, app_id, user_id, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes, status, created_at, expires_at, uploaded_at
           FROM zook_client_log_upload_tasks
           WHERE app_id = $1
           ORDER BY created_at DESC`,
          [appId],
        )
      : await this.query(
          `SELECT id, app_id, user_id, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes, status, created_at, expires_at, uploaded_at
           FROM zook_client_log_upload_tasks
           ORDER BY created_at DESC`,
        );
    return result.rows.map(parseClientLogUploadTask);
  }

  override async findClientLogUploadTask(taskId: string): Promise<ClientLogUploadTaskRecord | undefined> {
    const result = await this.query(
      `SELECT id, app_id, user_id, key_id, from_ts_ms, to_ts_ms, max_lines, max_bytes, status, created_at, expires_at, uploaded_at
       FROM zook_client_log_upload_tasks
       WHERE id = $1
       LIMIT 1`,
      [taskId],
    );
    return result.rows[0] ? parseClientLogUploadTask(result.rows[0]) : undefined;
  }

  override async updateClientLogUploadTask(
    taskId: string,
    patch: Partial<Pick<ClientLogUploadTaskRecord, "status" | "uploadedAt">>,
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [taskId];
    let index = 2;

    if (patch.status !== undefined) {
      fields.push(`status = $${index++}`);
      values.push(patch.status);
    }

    if (patch.uploadedAt !== undefined) {
      fields.push(`uploaded_at = $${index++}::timestamptz`);
      values.push(patch.uploadedAt);
    }

    if (fields.length === 0) {
      return;
    }

    fields.push("updated_at = NOW()");
    await this.query(
      `UPDATE zook_client_log_upload_tasks
       SET ${fields.join(", ")}
       WHERE id = $1`,
      values,
    );
  }

  override async insertClientLogUpload(record: ClientLogUploadRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_client_log_uploads (
         id, task_id, app_id, user_id, key_id, encryption, content_encoding, nonce_base64,
         line_count_reported, plain_bytes_reported, compressed_bytes_reported, encrypted_bytes,
         accepted_count, rejected_count, uploaded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz)`,
      [
        record.id,
        record.taskId,
        record.appId,
        record.userId,
        record.keyId,
        record.encryption,
        record.contentEncoding,
        record.nonceBase64,
        record.lineCountReported ?? null,
        record.plainBytesReported ?? null,
        record.compressedBytesReported ?? null,
        record.encryptedBytes,
        record.acceptedCount,
        record.rejectedCount,
        record.uploadedAt,
      ],
    );
  }

  override async insertClientLogLines(records: ClientLogLineRecord[]): Promise<void> {
    for (const record of records) {
      await this.query(
        `INSERT INTO zook_client_log_lines (
           id, upload_id, task_id, app_id, user_id, timestamp_ms, level, message, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)`,
        [
          record.id,
          record.uploadId,
          record.taskId,
          record.appId,
          record.userId,
          record.timestampMs ?? null,
          record.level ?? null,
          record.message ?? null,
          JSON.stringify(record.payload ?? {}),
          record.createdAt,
        ],
      );
    }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.withExclusiveSession(async () => {
      await this.seedDefaults();
    });
    this.initialized = true;
  }

  private async seedDefaults(): Promise<void> {
    for (const record of this.seed.apps ?? []) {
      await this.insertApp(record);
    }
    for (const record of this.seed.users ?? []) {
      await this.insertUser(record);
    }
    for (const record of this.seed.appUsers ?? []) {
      await this.insertAppUser(record);
    }
    for (const record of this.seed.roles ?? []) {
      await this.query(
        `INSERT INTO zook_roles (id, app_id, code, name, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [record.id, record.appId, record.code, record.name, record.status],
      );
    }
    for (const record of this.seed.permissions ?? []) {
      await this.query(
        `INSERT INTO zook_permissions (id, code, name, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [record.id, record.code, record.name, record.status],
      );
    }
    for (const record of this.seed.rolePermissions ?? []) {
      await this.query(
        `INSERT INTO zook_role_permissions (id, role_id, permission_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [record.id, record.roleId, record.permissionId],
      );
    }
    for (const record of this.seed.userRoles ?? []) {
      await this.query(
        `INSERT INTO zook_user_roles (id, app_id, user_id, role_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [record.id, record.appId, record.userId, record.roleId],
      );
    }
    for (const record of this.seed.appConfigs ?? []) {
      await this.query(
        `INSERT INTO zook_app_configs (id, app_id, config_key, config_value, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         ON CONFLICT (app_id, config_key) DO NOTHING`,
        [record.id, record.appId, record.configKey, record.configValue, record.updatedAt],
      );
    }
  }

  private async listRolePermissions(): Promise<RolePermissionRecord[]> {
    const result = await this.query("SELECT id, role_id, permission_id FROM zook_role_permissions ORDER BY id ASC");
    return result.rows.map(parseRolePermission);
  }

  private async query(sql: string, values: unknown[] = []) {
    const client = this.sessionContext.getStore();
    if (client) {
      return await client.query(sql, values);
    }

    return await this.pool.query(sql, values);
  }
}

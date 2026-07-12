import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import type {
  AnalyticsEventRecord,
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
  AppConfigRecord,
  AppNameI18n,
  AppRecord,
  AppUserRecord,
  AuditLogRecord,
  ClientLogLineRecord,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  ContentSafetyCheckRecord,
  DatabaseSeed,
  EmailDeliveryEventRecord,
  FeedbackAttachmentRecord,
  FeedbackRecord,
  FailedEventRecord,
  FileRecord,
  NotificationJobRecord,
  PermissionRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
  SmsVerificationRecord,
} from "../../../shared/types.ts";
import { ApplicationDatabase, type ManagedStateSnapshot } from "../application-database.ts";
import { runPostgresMigrations } from "./migrate.ts";
import { deletePostgresApp } from "./postgres-app-delete.ts";
import { deletePostgresAppUserRuntimeData } from "./postgres-app-user-delete.ts";
import { PostgresAiNovelStatisticsStore } from "./postgres-ai-novel-statistics.ts";
import { PostgresAppUserStore } from "./postgres-app-users.ts";
import { PostgresEmailDeliveryEventStore } from "./postgres-email-delivery-events.ts";
import { PostgresFeedbackStore } from "./postgres-feedback.ts";
import { PostgresOperationalRecordsStore } from "./postgres-operational-records.ts";
import { seedPostgresDefaults } from "./postgres-seed.ts";
import {
  parseApp,
  parseAppConfig,
  parsePermission,
  parseRole,
  parseRolePermission,
  parseUser,
  parseUserRole,
} from "./postgres-row-parsers.ts";

export class PostgresDatabase extends ApplicationDatabase {
  private readonly sessionContext = new AsyncLocalStorage<PoolClient>();
  private readonly emailDeliveryEvents: PostgresEmailDeliveryEventStore;
  private readonly appUsers: PostgresAppUserStore;
  private readonly feedback: PostgresFeedbackStore;
  private readonly aiNovelStatistics: PostgresAiNovelStatisticsStore;
  private readonly operationalRecords: PostgresOperationalRecordsStore;
  private initialized = false;

  private constructor(
    private readonly pool: Pool,
    private readonly seed: DatabaseSeed,
  ) {
    super();
    this.appUsers = new PostgresAppUserStore(
      async (sql, values = []) => await this.query(sql, values),
    );
    this.emailDeliveryEvents = new PostgresEmailDeliveryEventStore(async (sql, values = []) => await this.query(sql, values));
    this.feedback = new PostgresFeedbackStore(async (sql, values = []) => await this.query(sql, values));
    this.aiNovelStatistics = new PostgresAiNovelStatisticsStore(async (sql, values = []) => await this.query(sql, values));
    this.operationalRecords = new PostgresOperationalRecordsStore(
      async (sql, values = []) => await this.query(sql, values),
    );
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
    await deletePostgresApp(async (sql, values) => await this.query(sql, values), appId);
  }

  override async listAppUsers(appId?: string): Promise<AppUserRecord[]> {
    return this.appUsers.list(appId);
  }

  override async findAppUser(appId: string, userId: string): Promise<AppUserRecord | undefined> {
    return this.appUsers.find(appId, userId);
  }

  override async insertAppUser(record: AppUserRecord): Promise<void> {
    await this.appUsers.insert(record);
  }

  override async updateAppUserStatus(
    appId: string,
    userId: string,
    status: AppUserRecord["status"],
  ): Promise<AppUserRecord | undefined> {
    return this.appUsers.updateStatus(appId, userId, status);
  }

  override async finalizeAppUserAccountRegion(
    appId: string,
    userId: string,
    accountRegion: "CN" | "GLOBAL",
  ): Promise<AppUserRecord | undefined> {
    return this.appUsers.finalizeAccountRegion(
      appId,
      userId,
      accountRegion,
    );
  }

  override async deleteAppUserRuntimeData(appId: string, userId: string): Promise<void> {
    await deletePostgresAppUserRuntimeData(
      async (sql, values = []) => await this.query(sql, values),
      appId,
      userId,
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

  override async findUserByPhone(phone: string): Promise<UserRecord | undefined> {
    const normalized = phone.trim().toLowerCase();
    const result = await this.query(
      `SELECT id, email, phone, password_hash, password_algo, status, created_at
       FROM zook_users
       WHERE lower(coalesce(phone, '')) = $1
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
    await this.operationalRecords.insertAnalyticsEvents(records);
  }

  override async listAnalyticsEvents(appId: string): Promise<AnalyticsEventRecord[]> {
    return await this.operationalRecords.listAnalyticsEvents(appId);
  }

  override async insertFile(record: FileRecord): Promise<void> {
    await this.operationalRecords.insertFile(record);
  }
  override async findFileByOwnerAndStorageKey(appId: string, ownerUserId: string, storageKey: string): Promise<FileRecord | undefined> {
    return await this.operationalRecords.findFileByOwnerAndStorageKey(
      appId,
      ownerUserId,
      storageKey,
    );
  }
  override async findFileByAppAndStorageKey(appId: string, storageKey: string): Promise<FileRecord | undefined> {
    return await this.operationalRecords.findFileByAppAndStorageKey(
      appId,
      storageKey,
    );
  }
  override async confirmFile(fileId: string, mimeType: string, sizeBytes: number): Promise<FileRecord | undefined> {
    return await this.operationalRecords.confirmFile(fileId, mimeType, sizeBytes);
  }
  override async listSmsVerificationRecords(appId?: string): Promise<SmsVerificationRecord[]> {
    return await this.operationalRecords.listSmsVerificationRecords(appId);
  }
  override async findSmsVerificationRecord(recordId: string): Promise<SmsVerificationRecord | undefined> {
    return await this.operationalRecords.findSmsVerificationRecord(recordId);
  }
  override async insertSmsVerificationRecord(record: SmsVerificationRecord): Promise<void> {
    await this.operationalRecords.insertSmsVerificationRecord(record);
  }
  override async updateSmsVerificationRecord(
    recordId: string,
    patch: Partial<
      Pick<
        SmsVerificationRecord,
        "status" | "providerRequestId" | "providerSerialNo" | "providerMessage" | "consumedAt" | "failedAt" | "revealCount" | "lastRevealedAt" | "updatedAt"
      >
    >,
  ): Promise<void> {
    await this.operationalRecords.updateSmsVerificationRecord(recordId, patch);
  }
  override async deleteSmsVerificationRecordsCreatedBefore(cutoffIso: string): Promise<number> {
    return await this.operationalRecords.deleteSmsVerificationRecordsCreatedBefore(cutoffIso);
  }
  override async insertEmailDeliveryEvent(record: EmailDeliveryEventRecord): Promise<void> {
    await this.emailDeliveryEvents.insert(record);
  }
  override async listEmailDeliveryEvents(filter: {
    event?: EmailDeliveryEventRecord["event"];
    email?: string;
    limit?: number;
  } = {}): Promise<EmailDeliveryEventRecord[]> {
    return await this.emailDeliveryEvents.list(filter);
  }
  override async insertFeedback(record: FeedbackRecord, attachments: FeedbackAttachmentRecord[]): Promise<void> { await this.feedback.insert(record, attachments); }
  override async listFeedbackRecords(filter: { appId: string; userId?: string; ipHash?: string; status?: FeedbackRecord["status"]; createdAtFromIso?: string; limit?: number }): Promise<FeedbackRecord[]> {
    return await this.feedback.list(filter);
  }
  override async updateFeedbackStatus(appId: string, feedbackId: string, status: FeedbackRecord["status"]): Promise<FeedbackRecord | undefined> {
    return await this.feedback.updateStatus(appId, feedbackId, status);
  }
  override async listFeedbackAttachments(feedbackIds: string[]): Promise<FeedbackAttachmentRecord[]> {
    return await this.feedback.listAttachments(feedbackIds);
  }
  override async findFeedbackAttachment(appId: string, feedbackId: string, attachmentId: string): Promise<FeedbackAttachmentRecord | undefined> {
    return await this.feedback.findAttachment(appId, feedbackId, attachmentId);
  }
  override async upsertAiNovelStatisticsSnapshot(record: AiNovelStatisticsSnapshotRecord): Promise<void> { await this.aiNovelStatistics.upsertSnapshot(record); }
  override async findAiNovelStatisticsSnapshot(appId: string, userId: string): Promise<AiNovelStatisticsSnapshotRecord | undefined> { return await this.aiNovelStatistics.findSnapshot(appId, userId); }
  override async upsertAiNovelDailyWritingStats(records: AiNovelDailyStatisticsRecord[]): Promise<void> { await this.aiNovelStatistics.upsertDailyWritingStats(records); }
  override async incrementAiNovelDailyTokenUsage(appId: string, userId: string, date: string, tokens: number, updatedAt: string): Promise<void> { await this.aiNovelStatistics.incrementDailyTokenUsage(appId, userId, date, tokens, updatedAt); }
  override async listAiNovelDailyStatistics(filter: { appId: string; userId: string; dateFrom?: string; dateTo?: string }): Promise<AiNovelDailyStatisticsRecord[]> {
    return await this.aiNovelStatistics.listDailyStatistics(filter);
  }
  override async insertNotificationJob(record: NotificationJobRecord): Promise<void> {
    await this.operationalRecords.insertNotificationJob(record);
  }
  override async findNotificationJob(jobId: string): Promise<NotificationJobRecord | undefined> {
    return await this.operationalRecords.findNotificationJob(jobId);
  }
  override async updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount">>,
  ): Promise<NotificationJobRecord | undefined> {
    return await this.operationalRecords.updateNotificationJob(jobId, patch);
  }
  override async insertFailedEvent(record: FailedEventRecord): Promise<void> {
    await this.operationalRecords.insertFailedEvent(record);
  }
  override async listFailedEvents(appId?: string): Promise<FailedEventRecord[]> {
    return await this.operationalRecords.listFailedEvents(appId);
  }
  override async deleteFailedEvent(eventId: string): Promise<void> {
    await this.operationalRecords.deleteFailedEvent(eventId);
  }
  override async updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): Promise<void> {
    await this.operationalRecords.updateFailedEvent(eventId, patch);
  }
  override async listClientLogUploadTasks(appId?: string): Promise<ClientLogUploadTaskRecord[]> {
    return await this.operationalRecords.listClientLogUploadTasks(appId);
  }
  override async findClientLogUploadTask(taskId: string): Promise<ClientLogUploadTaskRecord | undefined> {
    return await this.operationalRecords.findClientLogUploadTask(taskId);
  }
  override async insertClientLogUploadTask(record: ClientLogUploadTaskRecord): Promise<void> {
    await this.operationalRecords.insertClientLogUploadTask(record);
  }
  override async updateClientLogUploadTask(
    taskId: string,
    patch: Partial<
      Pick<
        ClientLogUploadTaskRecord,
        "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt" | "uploadedFileName" | "uploadedFilePath" | "uploadedFileSizeBytes" | "uploadedLineCount" | "failedAt" | "failureReason"
      >
    >,
  ): Promise<void> {
    await this.operationalRecords.updateClientLogUploadTask(taskId, patch);
  }
  override async insertClientLogUpload(record: ClientLogUploadRecord): Promise<void> {
    await this.operationalRecords.insertClientLogUpload(record);
  }
  override async insertClientLogLines(records: ClientLogLineRecord[]): Promise<void> {
    await this.operationalRecords.insertClientLogLines(records);
  }
  override async insertContentSafetyCheckRecord(record: ContentSafetyCheckRecord): Promise<void> {
    await this.operationalRecords.insertContentSafetyCheckRecord(record);
  }

  override async listContentSafetyCheckRecords(filter: {
    createdAtFromIso?: string;
    createdAtToIso?: string;
    appId?: string;
    source?: ContentSafetyCheckRecord["source"];
    method?: ContentSafetyCheckRecord["method"];
    taskType?: string;
    decision?: ContentSafetyCheckRecord["decision"];
    limit?: number;
  } = {}): Promise<ContentSafetyCheckRecord[]> {
    return await this.operationalRecords.listContentSafetyCheckRecords(filter);
  }

  override async deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso: string): Promise<number> {
    return await this.operationalRecords.deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.withExclusiveSession(async () => {
      await seedPostgresDefaults(this.seed, {
        query: async (sql, values = []) => await this.query(sql, values),
        insertUser: async (record) => await this.insertUser(record),
        insertAppUser: async (record) => await this.insertAppUser(record),
        insertSmsVerificationRecord: async (record) =>
          await this.insertSmsVerificationRecord(record),
      });
    });
    this.initialized = true;
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

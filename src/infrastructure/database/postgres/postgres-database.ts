import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import type {
  AnalyticsEventRecord,
  AiNovelDailyStatisticsRecord,
  AiNovelStatisticsSnapshotRecord,
  AiOutputReactionRecord,
  AiOutputReportRecord,
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
  FailedEventRecord,
  FeedbackAttachmentRecord,
  FeedbackRecord,
  FileRecord,
  FrogSleepBuddyDomainRelationshipRecord,
  FrogSleepBuddyDomainSlotRecord,
  FrogSleepBuddyInvitationBundleRecord,
  FrogSleepBuddyInvitationDomainDecisionRecord,
  FrogSleepBuddyInvitationEmailAttemptRecord,
  FrogSleepBuddyInvitationEmailDeliveryRecord,
  FrogSleepBuddyInvitationReceiptAttemptRecord,
  FrogSleepBuddyGroupInvitationRecord,
  FrogSleepBuddyGroupMemberRecord,
  FrogSleepBuddyGroupRecord,
  FrogSleepBuddyNotificationDeliveryRecord,
  FrogSleepBuddyNotificationOutboxRecord,
  FrogSleepBuddyNotificationRecord,
  FrogSleepBuddySharingGrantRecord,
  FrogSleepDeviceRecord,
  FrogSleepEntityFilter,
  FrogSleepEntityKind,
  FrogSleepEntityRecord,
  NotificationJobRecord,
  PermissionRecord,
  RolePermissionRecord,
  RoleRecord,
  SmsVerificationRecord,
  UserRecord,
  UserRoleRecord,
} from "../../../shared/types.ts";
import { ApplicationDatabase, type ManagedStateSnapshot } from "../application-database.ts";
import { runPostgresMigrations } from "./migrate.ts";
import { deletePostgresApp } from "./postgres-app-delete.ts";
import { deletePostgresAppUserRuntimeData } from "./postgres-app-user-delete.ts";
import { PostgresAiNovelStatisticsStore } from "./postgres-ai-novel-statistics.ts";
import { PostgresAiOutputReportingStore } from "./postgres-ai-output-reporting.ts";
import { PostgresAppUserStore } from "./postgres-app-users.ts";
import { PostgresEmailDeliveryEventStore } from "./postgres-email-delivery-events.ts";
import { PostgresFeedbackStore } from "./postgres-feedback.ts";
import { PostgresFrogSleepStore } from "./postgres-frogsleep.ts";
import { PostgresBuddyGroupRepository } from "./postgres-buddy-group-repository.ts";
import { PostgresBuddyGrowthRepository } from "./postgres-buddy-growth-repository.ts";
import { PostgresBuddyCommandTransaction, type FrogSleepBuddyCommandSlotKey } from "./postgres-buddy-command-transaction.ts";
import { PostgresBuddyDecisionSafetyTransaction } from "./postgres-buddy-decision-safety-transaction.ts";
import type { FrogSleepBuddyInvitationDecisionSafetyKey } from "../../../modules/frogsleep/buddy-growth/buddy-decision-safety-key.ts";
import { findPostgresBodyLogProfile, upsertPostgresBodyLogProfile, type BodyLogProfileRecord } from "./postgres-bodylog-profile.ts";
import { PostgresBodyLogSocialStore } from "./postgres-bodylog-social.ts";
import { PostgresBodyLogLeaderboardStore } from "./postgres-bodylog-leaderboard.ts";
import { PostgresBodyLogInvitationStore } from "./postgres-bodylog-invitations.ts";
import { PostgresBodyLogChallengeStore } from "./postgres-bodylog-challenges.ts";
import type { BodyLogBlockRecord, BodyLogFriendRequestRecord, BodyLogFriendshipRecord, BodyLogReportRecord } from "../../../modules/bodylog/bodylog-social.types.ts";
import type { BodyLogDailyAggregate, BodyLogLeaderboardEntryRecord, BodyLogWeeklyGoalSnapshot } from "../../../modules/bodylog/bodylog-scoring.types.ts";
import type { BodyLogInvitationAttributionRecord, BodyLogInvitationRecord } from "../../../modules/bodylog/bodylog-invitation.types.ts";
import type { BodyLogChallengeMemberRecord, BodyLogChallengeRecord } from "../../../modules/bodylog/bodylog-challenge.types.ts";
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
  private readonly frogSleep: PostgresFrogSleepStore;
  private readonly buddyGroups: PostgresBuddyGroupRepository;
  private readonly buddyGrowth: PostgresBuddyGrowthRepository;
  private readonly buddyCommandTransaction: PostgresBuddyCommandTransaction<PoolClient>;
  private readonly buddyDecisionSafetyTransaction: PostgresBuddyDecisionSafetyTransaction<PoolClient>;
  private readonly aiNovelStatistics: PostgresAiNovelStatisticsStore;
  private readonly aiOutputReporting: PostgresAiOutputReportingStore;
  private readonly operationalRecords: PostgresOperationalRecordsStore;
  private readonly bodyLogSocial: PostgresBodyLogSocialStore;
  private readonly bodyLogLeaderboard: PostgresBodyLogLeaderboardStore;
  private readonly bodyLogInvitations: PostgresBodyLogInvitationStore;
  private readonly bodyLogChallenges: PostgresBodyLogChallengeStore;
  private initialized = false;
  private constructor(private readonly pool: Pool, private readonly seed: DatabaseSeed) {
    super();
    this.appUsers = new PostgresAppUserStore(async (sql, values = []) => await this.query(sql, values));
    this.emailDeliveryEvents = new PostgresEmailDeliveryEventStore(async (sql, values = []) => await this.query(sql, values));
    this.feedback = new PostgresFeedbackStore(async (sql, values = []) => await this.query(sql, values));
    this.frogSleep = new PostgresFrogSleepStore(async (sql, values = []) => await this.query(sql, values));
    this.buddyGroups = new PostgresBuddyGroupRepository({ query: async (sql, values = []) => await this.query(sql, values) });
    this.buddyGrowth = new PostgresBuddyGrowthRepository({ query: async (sql, values = []) => await this.query(sql, values) });
    this.buddyCommandTransaction = new PostgresBuddyCommandTransaction({ connect: async () => await this.pool.connect(), runWithClient: async (client, fn) => await this.sessionContext.run(client, fn) });
    this.buddyDecisionSafetyTransaction = new PostgresBuddyDecisionSafetyTransaction({ connect: async () => await this.pool.connect(), runWithClient: async (client, fn) => await this.sessionContext.run(client, fn) });
    this.aiNovelStatistics = new PostgresAiNovelStatisticsStore(async (sql, values = []) => await this.query(sql, values));
    this.aiOutputReporting = new PostgresAiOutputReportingStore(async (sql, values = []) => await this.query(sql, values));
    this.operationalRecords = new PostgresOperationalRecordsStore(async (sql, values = []) => await this.query(sql, values));
    this.bodyLogSocial = new PostgresBodyLogSocialStore(async (sql, values = []) => await this.query(sql, values));
    this.bodyLogLeaderboard = new PostgresBodyLogLeaderboardStore(async (sql, values = []) => await this.query(sql, values));
    this.bodyLogInvitations = new PostgresBodyLogInvitationStore(async (sql, values = []) => await this.query(sql, values));
    this.bodyLogChallenges = new PostgresBodyLogChallengeStore(async (sql, values = []) => await this.query(sql, values));
  }
  static async create(
    connectionString: string,
    seed: DatabaseSeed = {},
    options: { migrationConnectionString?: string } = {},
  ): Promise<PostgresDatabase> {
    await runPostgresMigrations({
      connectionString: options.migrationConnectionString?.trim() || connectionString,
      log: (message) => console.log(message),
    });
    const pool = new Pool({ connectionString });
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

  override async withFrogSleepBuddyCommandTransaction<T>(slotKeys: FrogSleepBuddyCommandSlotKey[], fn: () => Promise<T> | T): Promise<T> { return await this.buddyCommandTransaction.run(slotKeys, fn); }
  override async withFrogSleepBuddyInvitationDecisionSafetyTransaction<T>(key: FrogSleepBuddyInvitationDecisionSafetyKey, fn: () => Promise<T> | T): Promise<T> { return await this.buddyDecisionSafetyTransaction.run(key, fn); }
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
    return await this.appUsers.list(appId);
  }

  override async findAppUser(appId: string, userId: string): Promise<AppUserRecord | undefined> {
    return await this.appUsers.find(appId, userId);
  }

  override async insertAppUser(record: AppUserRecord): Promise<void> {
    await this.appUsers.insert(record);
  }

  override async updateAppUserStatus(
    appId: string,
    userId: string,
    status: AppUserRecord["status"],
  ): Promise<AppUserRecord | undefined> {
    return await this.appUsers.updateStatus(appId, userId, status);
  }

  override async finalizeAppUserAccountRegion(
    appId: string,
    userId: string,
    accountRegion: Exclude<AppUserRecord["accountRegion"], "UNKNOWN">,
  ): Promise<AppUserRecord | undefined> {
    return await this.appUsers.finalizeAccountRegion(appId, userId, accountRegion);
  }

  override async deleteAppUserRuntimeData(appId: string, userId: string): Promise<void> {
    await deletePostgresAppUserRuntimeData(
      async (sql, values = []) => await this.query(sql, values),
      appId,
      userId,
    );
  }
  override async findBodyLogProfile(appId: string, userId: string): Promise<BodyLogProfileRecord | undefined> { return await findPostgresBodyLogProfile(async (sql, values) => await this.query(sql, values), appId, userId); }
  override async upsertBodyLogProfile(record: BodyLogProfileRecord): Promise<BodyLogProfileRecord> { return await upsertPostgresBodyLogProfile(async (sql, values) => await this.query(sql, values), record); }
  override async listBodyLogFriendRequests(appId: string): Promise<BodyLogFriendRequestRecord[]> { return await this.bodyLogSocial.listFriendRequests(appId); }
  override async upsertBodyLogFriendRequest(record: BodyLogFriendRequestRecord): Promise<BodyLogFriendRequestRecord> { return await this.bodyLogSocial.upsertFriendRequest(record); }
  override async listBodyLogFriendships(appId: string): Promise<BodyLogFriendshipRecord[]> { return await this.bodyLogSocial.listFriendships(appId); }
  override async insertBodyLogFriendship(record: BodyLogFriendshipRecord): Promise<void> { await this.bodyLogSocial.insertFriendship(record); }
  override async deleteBodyLogFriendship(appId: string, userId: string, friendUserId: string): Promise<void> { await this.bodyLogSocial.deleteFriendship(appId, userId, friendUserId); }
  override async listBodyLogBlocks(appId: string): Promise<BodyLogBlockRecord[]> { return await this.bodyLogSocial.listBlocks(appId); }
  override async insertBodyLogBlock(record: BodyLogBlockRecord): Promise<void> { await this.bodyLogSocial.insertBlock(record); }
  override async deleteBodyLogBlock(appId: string, blockerUserId: string, blockedUserId: string): Promise<void> { await this.bodyLogSocial.deleteBlock(appId, blockerUserId, blockedUserId); }
  override async insertBodyLogReport(record: BodyLogReportRecord): Promise<void> { await this.bodyLogSocial.insertReport(record); }
  override async listBodyLogReports(appId: string, reporterUserId: string): Promise<BodyLogReportRecord[]> { return await this.bodyLogSocial.listReports(appId, reporterUserId); }
  override async findBodyLogWeeklyGoalSnapshot(appId: string, userId: string, seasonLabel: string): Promise<BodyLogWeeklyGoalSnapshot | undefined> { return await this.bodyLogLeaderboard.findSnapshot(appId, userId, seasonLabel); }
  override async upsertBodyLogWeeklyGoalSnapshot(record: BodyLogWeeklyGoalSnapshot): Promise<BodyLogWeeklyGoalSnapshot> { return await this.bodyLogLeaderboard.upsertSnapshot(record); }
  override async listBodyLogDailyAggregates(appId: string, userId: string, seasonLabel: string): Promise<BodyLogDailyAggregate[]> { return await this.bodyLogLeaderboard.listAggregates(appId, userId, seasonLabel); }
  override async upsertBodyLogDailyAggregate(record: BodyLogDailyAggregate): Promise<BodyLogDailyAggregate> { return await this.bodyLogLeaderboard.upsertAggregate(record); }
  override async findBodyLogLeaderboardEntry(appId: string, userId: string, seasonLabel: string): Promise<BodyLogLeaderboardEntryRecord | undefined> { return await this.bodyLogLeaderboard.findEntry(appId, userId, seasonLabel); }
  override async upsertBodyLogLeaderboardEntry(record: BodyLogLeaderboardEntryRecord): Promise<BodyLogLeaderboardEntryRecord> { return await this.bodyLogLeaderboard.upsertEntry(record); }
  override async listBodyLogLeaderboardEntries(appId: string, seasonLabel: string): Promise<BodyLogLeaderboardEntryRecord[]> { return await this.bodyLogLeaderboard.listEntries(appId, seasonLabel); }
  override async findBodyLogInvitationByTokenHash(appId: string, tokenHash: string): Promise<BodyLogInvitationRecord | undefined> { return await this.bodyLogInvitations.findByTokenHash(appId, tokenHash); }
  override async insertBodyLogInvitation(record: BodyLogInvitationRecord): Promise<void> { await this.bodyLogInvitations.insertInvitation(record); }
  override async listBodyLogInvitations(appId: string, inviterUserId: string): Promise<BodyLogInvitationRecord[]> { return await this.bodyLogInvitations.listInvitations(appId, inviterUserId); }
  override async insertBodyLogInvitationAttribution(record: BodyLogInvitationAttributionRecord): Promise<void> { await this.bodyLogInvitations.insertAttribution(record); }
  override async updateBodyLogInvitationAttribution(record: BodyLogInvitationAttributionRecord): Promise<void> { await this.bodyLogInvitations.updateAttribution(record); }
  override async listBodyLogInvitationAttributions(appId: string): Promise<BodyLogInvitationAttributionRecord[]> { return await this.bodyLogInvitations.listAttributions(appId); }
  override async insertBodyLogChallenge(record: BodyLogChallengeRecord): Promise<void> { await this.bodyLogChallenges.insertChallenge(record); }
  override async updateBodyLogChallenge(record: BodyLogChallengeRecord): Promise<void> { await this.bodyLogChallenges.updateChallenge(record); }
  override async listBodyLogChallenges(appId: string): Promise<BodyLogChallengeRecord[]> { return await this.bodyLogChallenges.listChallenges(appId); }
  override async insertBodyLogChallengeMembers(records: BodyLogChallengeMemberRecord[]): Promise<void> { await this.bodyLogChallenges.insertMembers(records); }
  override async updateBodyLogChallengeMember(record: BodyLogChallengeMemberRecord): Promise<void> { await this.bodyLogChallenges.updateMember(record); }
  override async listBodyLogChallengeMembers(appId: string): Promise<BodyLogChallengeMemberRecord[]> { return await this.bodyLogChallenges.listMembers(appId); }
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

  override async updateUserEmail(userId: string, email: string): Promise<void> {
    await this.query(
      "UPDATE zook_users SET email = $2, updated_at = NOW() WHERE id = $1",
      [userId, email],
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
  override async insertFeedback(record: FeedbackRecord, attachments: FeedbackAttachmentRecord[]): Promise<void> {
    await this.feedback.insert(record, attachments);
  }
  override async listFeedbackRecords(filter: {
    appId: string;
    userId?: string;
    ipHash?: string;
    status?: FeedbackRecord["status"];
    createdAtFromIso?: string;
    limit?: number;
  }): Promise<FeedbackRecord[]> {
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
  override async insertAiOutputReport(record: AiOutputReportRecord): Promise<void> { await this.aiOutputReporting.insertReport(record); }
  override async findAiOutputReportBySubmission(appId: string, userId: string, submissionId: string): Promise<AiOutputReportRecord | undefined> { return await this.aiOutputReporting.findReportBySubmission(appId, userId, submissionId); }
  override async findAiOutputReportById(appId: string, reportId: string): Promise<AiOutputReportRecord | undefined> { return await this.aiOutputReporting.findReportById(appId, reportId); }
  override async listAiOutputReports(filter: { appId: string; userId?: string; category?: AiOutputReportRecord["category"]; status?: AiOutputReportRecord["status"]; createdAtFromIso?: string; limit?: number }): Promise<AiOutputReportRecord[]> { return await this.aiOutputReporting.listReports(filter); }
  override async updateAiOutputReportStatus(appId: string, reportId: string, status: AiOutputReportRecord["status"], resolutionCode?: string, resolutionNote?: string): Promise<AiOutputReportRecord | undefined> { return await this.aiOutputReporting.updateReportStatus(appId, reportId, status, resolutionCode, resolutionNote); }
  override async insertAiOutputReaction(record: AiOutputReactionRecord): Promise<void> { await this.aiOutputReporting.insertReaction(record); }
  override async findAiOutputReactionBySubmission(appId: string, userId: string, submissionId: string): Promise<AiOutputReactionRecord | undefined> { return await this.aiOutputReporting.findReactionBySubmission(appId, userId, submissionId); }
  override async upsertAiNovelStatisticsSnapshot(record: AiNovelStatisticsSnapshotRecord): Promise<void> { await this.aiNovelStatistics.upsertSnapshot(record); }
  override async findAiNovelStatisticsSnapshot(appId: string, userId: string): Promise<AiNovelStatisticsSnapshotRecord | undefined> { return await this.aiNovelStatistics.findSnapshot(appId, userId); }
  override async replaceAiNovelDailyWritingStats(appId: string, userId: string, records: AiNovelDailyStatisticsRecord[], updatedAt: string): Promise<void> { await this.aiNovelStatistics.replaceDailyWritingStats(appId, userId, records, updatedAt); }
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
  override async upsertFrogSleepDevice(record: FrogSleepDeviceRecord): Promise<FrogSleepDeviceRecord> { return await this.frogSleep.upsertDevice(record); }
  override async deleteFrogSleepDevice(appId: string, userId: string, deviceId: string): Promise<FrogSleepDeviceRecord | undefined> { return await this.frogSleep.deleteDevice(appId, userId, deviceId); }
  override async listFrogSleepDevices(filter: { appId: string; userId?: string; pushEnabled?: boolean; includeDeleted?: boolean }): Promise<FrogSleepDeviceRecord[]> { return await this.frogSleep.listDevices(filter); }
  override async insertFrogSleepEntity(record: FrogSleepEntityRecord): Promise<void> { await this.frogSleep.insertEntity(record); }
  override async findFrogSleepEntity(kind: FrogSleepEntityKind, appId: string, id: string): Promise<FrogSleepEntityRecord | undefined> { return await this.frogSleep.findEntity(kind, appId, id); }
  override async findFrogSleepEntityByCode(kind: FrogSleepEntityKind, appId: string, code: string): Promise<FrogSleepEntityRecord | undefined> { return await this.frogSleep.findEntityByCode(kind, appId, code); }
  override async findFrogSleepEntityByToken(kind: FrogSleepEntityKind, appId: string, token: string): Promise<FrogSleepEntityRecord | undefined> { return await this.frogSleep.findEntityByToken(kind, appId, token); }
  override async listFrogSleepEntities(filter: FrogSleepEntityFilter): Promise<FrogSleepEntityRecord[]> { return await this.frogSleep.listEntities(filter); }
  override async updateFrogSleepEntity(kind: FrogSleepEntityKind, appId: string, id: string, patch: Partial<Omit<FrogSleepEntityRecord, "id" | "kind" | "appId" | "createdAt">>): Promise<FrogSleepEntityRecord | undefined> { return await this.frogSleep.updateEntity(kind, appId, id, patch); }
  override async upsertFrogSleepBuddySharingGrant(record: FrogSleepBuddySharingGrantRecord): Promise<FrogSleepBuddySharingGrantRecord> { return await this.buddyGrowth.upsertGrant(record); }
  override async listFrogSleepBuddySharingGrants(appId: string, relationshipId: string): Promise<FrogSleepBuddySharingGrantRecord[]> { return await this.buddyGrowth.listGrants(appId, relationshipId); }
  override async findFrogSleepBuddySharingGrant(appId: string, grantId: string): Promise<FrogSleepBuddySharingGrantRecord | undefined> { return await this.buddyGrowth.findGrant(appId, grantId); }
  override async updateFrogSleepBuddySharingGrant(appId: string, grantId: string, expectedVersion: number, state: FrogSleepBuddySharingGrantRecord["state"]): Promise<FrogSleepBuddySharingGrantRecord | undefined> { return await this.buddyGrowth.updateGrant(appId, grantId, expectedVersion, state); }
  override async upsertFrogSleepBuddyInvitationBundle(record: FrogSleepBuddyInvitationBundleRecord): Promise<FrogSleepBuddyInvitationBundleRecord> { return await this.buddyGrowth.upsertBundle(record); } override async findFrogSleepBuddyInvitationBundle(appId: string, bundleId: string): Promise<FrogSleepBuddyInvitationBundleRecord | undefined> { return await this.buddyGrowth.findBundle(appId, bundleId); } override async listFrogSleepBuddyInvitationBundles(input: { appId: string; userId: string; direction: "incoming" | "outgoing"; recipientEmailHash?: string; recipientEmail?: string }): Promise<FrogSleepBuddyInvitationBundleRecord[]> { return await this.buddyGrowth.listBundles(input); }
  override async findFrogSleepBuddyInvitationBundleByCode(appId: string, code: string): Promise<FrogSleepBuddyInvitationBundleRecord | undefined> { return await this.buddyGrowth.findBundleByCode(appId, code); } override async findFrogSleepBuddyInvitationBundleByToken(appId: string, token: string): Promise<FrogSleepBuddyInvitationBundleRecord | undefined> { return await this.buddyGrowth.findBundleByToken(appId, token); } override async enqueueFrogSleepBuddyInvitationEmailDelivery(record: FrogSleepBuddyInvitationEmailDeliveryRecord): Promise<FrogSleepBuddyInvitationEmailDeliveryRecord> { return await this.buddyGrowth.enqueueInvitationEmailDelivery(record); } override async findFrogSleepBuddyInvitationEmailDelivery(appId: string, invitationId: string): Promise<FrogSleepBuddyInvitationEmailDeliveryRecord | undefined> { return await this.buddyGrowth.findInvitationEmailDelivery(appId, invitationId); } override async findFrogSleepBuddyInvitationEmailDeliveryByProviderMessageId(providerMessageId: string): Promise<FrogSleepBuddyInvitationEmailDeliveryRecord | undefined> { return await this.buddyGrowth.findInvitationEmailDeliveryByProviderMessageId(providerMessageId); }
  override async listFrogSleepBuddyInvitationEmailDeliveries(filter: { invitationId?: string; status?: FrogSleepBuddyInvitationEmailDeliveryRecord["status"]; limit?: number } = {}): Promise<FrogSleepBuddyInvitationEmailDeliveryRecord[]> { return await this.buddyGrowth.listInvitationEmailDeliveries(filter); } override async claimReadyFrogSleepBuddyInvitationEmailDeliveries(nowIso: string, limit: number): Promise<FrogSleepBuddyInvitationEmailDeliveryRecord[]> { return await this.buddyGrowth.claimReadyInvitationEmailDeliveries(nowIso, limit); } override async updateFrogSleepBuddyInvitationEmailDelivery(id: string, patch: Partial<Omit<FrogSleepBuddyInvitationEmailDeliveryRecord, "id" | "appId" | "invitationId" | "createdAt">>): Promise<FrogSleepBuddyInvitationEmailDeliveryRecord | undefined> { return await this.buddyGrowth.updateInvitationEmailDelivery(id, patch); } override async insertFrogSleepBuddyInvitationEmailAttempt(record: FrogSleepBuddyInvitationEmailAttemptRecord): Promise<FrogSleepBuddyInvitationEmailAttemptRecord> { return await this.buddyGrowth.insertInvitationEmailAttempt(record); } override async listFrogSleepBuddyInvitationEmailAttempts(appId: string, deliveryId: string): Promise<FrogSleepBuddyInvitationEmailAttemptRecord[]> { return await this.buddyGrowth.listInvitationEmailAttempts(appId, deliveryId); }
  override async upsertFrogSleepBuddyInvitationDomainDecision(record: FrogSleepBuddyInvitationDomainDecisionRecord): Promise<FrogSleepBuddyInvitationDomainDecisionRecord> { return await this.buddyGrowth.upsertInvitationDomainDecision(record); }
  override async findFrogSleepBuddyInvitationDomainDecision(appId: string, invitationId: string, domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"]): Promise<FrogSleepBuddyInvitationDomainDecisionRecord | undefined> { return await this.buddyGrowth.findInvitationDomainDecision(appId, invitationId, domain); }
  override async listFrogSleepBuddyInvitationDomainDecisions(appId: string, invitationId: string): Promise<FrogSleepBuddyInvitationDomainDecisionRecord[]> { return await this.buddyGrowth.listInvitationDomainDecisions(appId, invitationId); } override async compareAndUpdateFrogSleepBuddyInvitationDomainDecision(input: { appId: string; invitationId: string; domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"]; expectedVersion: number; status: FrogSleepBuddyInvitationDomainDecisionRecord["status"]; decidedByUserId: string; decidedAt: string; idempotencyKeyHash: string; terminalReason?: string; updatedAt: string }): Promise<FrogSleepBuddyInvitationDomainDecisionRecord | undefined> { return await this.buddyGrowth.compareAndUpdateInvitationDomainDecision(input); }
  override async ensureFrogSleepBuddyDomainSlot(input: { appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; now: string }): Promise<FrogSleepBuddyDomainSlotRecord> { return await this.buddyGrowth.ensureDomainSlot(input); } override async findFrogSleepBuddyDomainSlot(appId: string, userId: string, domain: FrogSleepBuddyDomainSlotRecord["domain"]): Promise<FrogSleepBuddyDomainSlotRecord | undefined> { return await this.buddyGrowth.findDomainSlot(appId, userId, domain); }
  override async listFrogSleepBuddyDomainSlots(appId: string, userId: string): Promise<FrogSleepBuddyDomainSlotRecord[]> { return await this.buddyGrowth.listDomainSlots(appId, userId); } override async compareAndUpdateFrogSleepBuddyDomainSlot(input: { appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; expectedVersion: number; state: FrogSleepBuddyDomainSlotRecord["state"]; relationshipId?: string; updatedAt: string }): Promise<FrogSleepBuddyDomainSlotRecord | undefined> { return await this.buddyGrowth.compareAndUpdateDomainSlot(input); }
  override async insertFrogSleepBuddyDomainRelationship(record: FrogSleepBuddyDomainRelationshipRecord): Promise<FrogSleepBuddyDomainRelationshipRecord> { return await this.buddyGrowth.insertDomainRelationship(record); } override async findFrogSleepBuddyDomainRelationship(appId: string, relationshipId: string): Promise<FrogSleepBuddyDomainRelationshipRecord | undefined> { return await this.buddyGrowth.findDomainRelationship(appId, relationshipId); } override async listCurrentFrogSleepBuddyDomainRelationships(appId: string, userId: string, domain: FrogSleepBuddyDomainRelationshipRecord["domain"]): Promise<FrogSleepBuddyDomainRelationshipRecord[]> { return await this.buddyGrowth.listCurrentDomainRelationships(appId, userId, domain); }   override async compareAndUpdateFrogSleepBuddyDomainRelationship(input: { appId: string; id: string; expectedVersion: number; status: FrogSleepBuddyDomainRelationshipRecord["status"]; pausedByUserIds: string[]; revokedAt?: string; updatedAt: string }): Promise<FrogSleepBuddyDomainRelationshipRecord | undefined> { return await this.buddyGrowth.compareAndUpdateDomainRelationship(input); }
  override async insertFrogSleepBuddyGroup(record: FrogSleepBuddyGroupRecord): Promise<FrogSleepBuddyGroupRecord> { return await this.buddyGroups.insertGroup(record); } override async findFrogSleepBuddyGroup(appId: string, groupId: string): Promise<FrogSleepBuddyGroupRecord | undefined> { return await this.buddyGroups.findGroup(appId, groupId); } override async listFrogSleepBuddyGroupsForUser(appId: string, userId: string): Promise<FrogSleepBuddyGroupRecord[]> { return await this.buddyGroups.listGroupsForUser(appId, userId); } override async listFrogSleepBuddyGroupsForOwner(appId: string, ownerUserId: string): Promise<FrogSleepBuddyGroupRecord[]> { return await this.buddyGroups.listGroupsForOwner(appId, ownerUserId); } override async compareAndUpdateFrogSleepBuddyGroup(input: { appId: string; id: string; expectedVersion: number; status: FrogSleepBuddyGroupRecord["status"]; memberCount: number; sharingBaseline: string[]; dissolvedAt?: string; updatedAt: string; groupName?: string; groupDescription?: string; groupDescriptionSpecified?: boolean }): Promise<FrogSleepBuddyGroupRecord | undefined> { return await this.buddyGroups.compareAndUpdateGroup(input); }
  override async insertFrogSleepBuddyGroupMember(record: FrogSleepBuddyGroupMemberRecord): Promise<FrogSleepBuddyGroupMemberRecord> { return await this.buddyGroups.insertGroupMember(record); } override async findFrogSleepBuddyGroupMember(appId: string, groupId: string, userId: string): Promise<FrogSleepBuddyGroupMemberRecord | undefined> { return await this.buddyGroups.findGroupMember(appId, groupId, userId); } override async listFrogSleepBuddyGroupMembers(appId: string, groupId: string): Promise<FrogSleepBuddyGroupMemberRecord[]> { return await this.buddyGroups.listGroupMembers(appId, groupId); } override async compareAndUpdateFrogSleepBuddyGroupMember(input: { appId: string; groupId: string; userId: string; expectedVersion: number; role: FrogSleepBuddyGroupMemberRecord["role"]; status: FrogSleepBuddyGroupMemberRecord["status"]; leftAt?: string; updatedAt: string }): Promise<FrogSleepBuddyGroupMemberRecord | undefined> { return await this.buddyGroups.compareAndUpdateGroupMember(input); }
  override async insertFrogSleepBuddyGroupInvitation(record: FrogSleepBuddyGroupInvitationRecord): Promise<FrogSleepBuddyGroupInvitationRecord> { return await this.buddyGroups.insertGroupInvitation(record); } override async findFrogSleepBuddyGroupInvitation(appId: string, invitationId: string): Promise<FrogSleepBuddyGroupInvitationRecord | undefined> { return await this.buddyGroups.findGroupInvitation(appId, invitationId); } override async listFrogSleepBuddyGroupInvitations(appId: string, groupId: string): Promise<FrogSleepBuddyGroupInvitationRecord[]> { return await this.buddyGroups.listGroupInvitations(appId, groupId); } override async compareAndUpdateFrogSleepBuddyGroupInvitation(input: { appId: string; invitationId: string; expectedVersion: number; status: FrogSleepBuddyGroupInvitationRecord["status"]; respondedAt?: string; updatedAt: string }): Promise<FrogSleepBuddyGroupInvitationRecord | undefined> { return await this.buddyGroups.compareAndUpdateGroupInvitation(input); }
  override async upsertFrogSleepBuddyInvitationReceiptAttempt(record: FrogSleepBuddyInvitationReceiptAttemptRecord): Promise<FrogSleepBuddyInvitationReceiptAttemptRecord> { return await this.buddyGrowth.upsertInvitationReceiptAttempt(record); } override async findFrogSleepBuddyInvitationReceiptAttempt(appId: string, inviterUserId: string, recipientIdentityHash: string, domainsFingerprint: string): Promise<FrogSleepBuddyInvitationReceiptAttemptRecord | undefined> { return await this.buddyGrowth.findInvitationReceiptAttempt(appId, inviterUserId, recipientIdentityHash, domainsFingerprint); } override async findFrogSleepBuddyInvitationReceiptAttemptById(appId: string, inviterUserId: string, receiptId: string): Promise<FrogSleepBuddyInvitationReceiptAttemptRecord | undefined> { return await this.buddyGrowth.findInvitationReceiptAttemptById(appId, inviterUserId, receiptId); }
  override async enqueueFrogSleepBuddyNotificationOutbox(record: FrogSleepBuddyNotificationOutboxRecord): Promise<FrogSleepBuddyNotificationOutboxRecord> { return await this.buddyGrowth.enqueueNotification(record); }
  override async listReadyFrogSleepBuddyNotificationOutbox(nowIso: string, limit: number): Promise<FrogSleepBuddyNotificationOutboxRecord[]> { return await this.buddyGrowth.listReadyNotifications(nowIso, limit); }
  override async updateFrogSleepBuddyNotificationOutbox(id: string, patch: Partial<Pick<FrogSleepBuddyNotificationOutboxRecord, "status" | "attemptCount" | "processedAt" | "lastErrorCode" | "updatedAt">>): Promise<FrogSleepBuddyNotificationOutboxRecord | undefined> { return await this.buddyGrowth.updateNotificationOutbox(id, patch); }
  override async upsertFrogSleepBuddyNotification(record: FrogSleepBuddyNotificationRecord): Promise<FrogSleepBuddyNotificationRecord> { return await this.buddyGrowth.upsertNotification(record); }
  override async findFrogSleepBuddyNotification(appId: string, recipientUserId: string, notificationId: string): Promise<FrogSleepBuddyNotificationRecord | undefined> { return await this.buddyGrowth.findNotification(appId, recipientUserId, notificationId); }
  override async listFrogSleepBuddyNotifications(input: { appId: string; recipientUserId: string; limit: number; cursor?: string }): Promise<{ items: FrogSleepBuddyNotificationRecord[]; nextCursor?: string }> { return await this.buddyGrowth.listNotifications(input); }
  override async countUnreadFrogSleepBuddyNotifications(appId: string, recipientUserId: string): Promise<number> { return await this.buddyGrowth.countUnreadNotifications(appId, recipientUserId); }
  override async markFrogSleepBuddyNotificationRead(appId: string, recipientUserId: string, notificationId: string, readAt: string): Promise<FrogSleepBuddyNotificationRecord | undefined> { return await this.buddyGrowth.markNotificationRead(appId, recipientUserId, notificationId, readAt); }
  override async markAllFrogSleepBuddyNotificationsRead(appId: string, recipientUserId: string, readAt: string): Promise<number> { return await this.buddyGrowth.markAllNotificationsRead(appId, recipientUserId, readAt); }
  override async insertFrogSleepBuddyNotificationDelivery(record: FrogSleepBuddyNotificationDeliveryRecord): Promise<FrogSleepBuddyNotificationDeliveryRecord> { return await this.buddyGrowth.insertNotificationDelivery(record); }
  override async insertFailedEvent(record: FailedEventRecord): Promise<void> { await this.operationalRecords.insertFailedEvent(record); }
  override async listFailedEvents(appId?: string): Promise<FailedEventRecord[]> { return await this.operationalRecords.listFailedEvents(appId); }
  override async deleteFailedEvent(eventId: string): Promise<void> { await this.operationalRecords.deleteFailedEvent(eventId); }
  override async updateFailedEvent(eventId: string, patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">): Promise<void> { await this.operationalRecords.updateFailedEvent(eventId, patch); }
  override async listClientLogUploadTasks(appId?: string): Promise<ClientLogUploadTaskRecord[]> { return await this.operationalRecords.listClientLogUploadTasks(appId); }
  override async findClientLogUploadTask(taskId: string): Promise<ClientLogUploadTaskRecord | undefined> { return await this.operationalRecords.findClientLogUploadTask(taskId); }
  override async insertClientLogUploadTask(record: ClientLogUploadTaskRecord): Promise<void> { await this.operationalRecords.insertClientLogUploadTask(record); }
  override async updateClientLogUploadTask(taskId: string, patch: Partial<Pick<ClientLogUploadTaskRecord, "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt" | "uploadedFileName" | "uploadedFilePath" | "uploadedFileSizeBytes" | "uploadedLineCount" | "failedAt" | "failureReason">>): Promise<void> { await this.operationalRecords.updateClientLogUploadTask(taskId, patch); }
  override async insertClientLogUpload(record: ClientLogUploadRecord): Promise<void> { await this.operationalRecords.insertClientLogUpload(record); }
  override async insertClientLogLines(records: ClientLogLineRecord[]): Promise<void> { await this.operationalRecords.insertClientLogLines(records); }
  override async insertContentSafetyCheckRecord(record: ContentSafetyCheckRecord): Promise<void> { await this.operationalRecords.insertContentSafetyCheckRecord(record); }
  override async listContentSafetyCheckRecords(filter: { createdAtFromIso?: string; createdAtToIso?: string; appId?: string; source?: ContentSafetyCheckRecord["source"]; method?: ContentSafetyCheckRecord["method"]; taskType?: string; decision?: ContentSafetyCheckRecord["decision"]; limit?: number } = {}): Promise<ContentSafetyCheckRecord[]> { return await this.operationalRecords.listContentSafetyCheckRecords(filter); }
  override async deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso: string): Promise<number> { return await this.operationalRecords.deleteContentSafetyCheckRecordsCreatedBefore(cutoffIso); }

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

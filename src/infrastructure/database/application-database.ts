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
} from "../../shared/types.ts";

type MaybePromise<T> = T | Promise<T>;

export interface ManagedStateSnapshot {
  apps: AppRecord[];
  roles: RoleRecord[];
  rolePermissions: RolePermissionRecord[];
  appConfigs: AppConfigRecord[];
}

/**
 * ApplicationDatabase is the production-facing database contract.
 * Production implementations should talk to PostgreSQL directly.
 * Test doubles may keep in-memory state, but business code should only use this API.
 */
export abstract class ApplicationDatabase {
  abstract withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T>;
  abstract close(): Promise<void>;
  abstract exportManagedState(): MaybePromise<ManagedStateSnapshot>;

  abstract listApps(): MaybePromise<AppRecord[]>;
  abstract listAppIds(): MaybePromise<string[]>;
  abstract findApp(appId: string): MaybePromise<AppRecord | undefined>;
  abstract findAppByApiDomain(hostname: string): MaybePromise<AppRecord | undefined>;
  abstract insertApp(record: AppRecord): MaybePromise<void>;
  abstract updateAppNames(appId: string, name: string, nameI18n: AppNameI18n): MaybePromise<void>;
  abstract deleteApp(appId: string): MaybePromise<void>;

  abstract listAppUsers(appId?: string): MaybePromise<AppUserRecord[]>;
  abstract findAppUser(appId: string, userId: string): MaybePromise<AppUserRecord | undefined>;
  abstract insertAppUser(record: AppUserRecord): MaybePromise<void>;

  abstract listRoles(appId?: string): MaybePromise<RoleRecord[]>;
  abstract findRole(appId: string, roleCode: string): MaybePromise<RoleRecord | undefined>;
  abstract insertRoles(records: RoleRecord[]): MaybePromise<void>;

  abstract listPermissions(): MaybePromise<PermissionRecord[]>;
  abstract insertRolePermissions(records: RolePermissionRecord[]): MaybePromise<void>;
  abstract findUserRole(appId: string, userId: string, roleId: string): MaybePromise<UserRoleRecord | undefined>;
  abstract insertUserRole(record: UserRoleRecord): MaybePromise<void>;
  abstract getPermissionCodes(appId: string, userId: string): MaybePromise<string[]>;

  abstract findUserById(userId: string): MaybePromise<UserRecord | undefined>;
  abstract findUserByAccount(account: string): MaybePromise<UserRecord | undefined>;
  abstract findUserByPhone(phone: string): MaybePromise<UserRecord | undefined>;
  abstract insertUser(record: UserRecord): MaybePromise<void>;
  abstract updateUserPassword(userId: string, passwordHash: string, passwordAlgo: string): MaybePromise<void>;

  abstract insertAuditLog(record: AuditLogRecord): MaybePromise<void>;

  abstract listAppConfigs(appId?: string): MaybePromise<AppConfigRecord[]>;
  abstract findAppConfig(appId: string, configKey: string): MaybePromise<AppConfigRecord | undefined>;
  abstract upsertAppConfig(record: AppConfigRecord): MaybePromise<AppConfigRecord>;
  abstract deleteAppConfigsByApp(appId: string): MaybePromise<void>;

  abstract insertAnalyticsEvents(records: AnalyticsEventRecord[]): MaybePromise<void>;
  abstract listAnalyticsEvents(appId: string): MaybePromise<AnalyticsEventRecord[]>;

  abstract insertFile(record: FileRecord): MaybePromise<void>;
  abstract findFileByOwnerAndStorageKey(
    appId: string,
    ownerUserId: string,
    storageKey: string,
  ): MaybePromise<FileRecord | undefined>;
  abstract findFileByAppAndStorageKey(appId: string, storageKey: string): MaybePromise<FileRecord | undefined>;
  abstract confirmFile(fileId: string, mimeType: string, sizeBytes: number): MaybePromise<FileRecord | undefined>;

  abstract insertNotificationJob(record: NotificationJobRecord): MaybePromise<void>;
  abstract findNotificationJob(jobId: string): MaybePromise<NotificationJobRecord | undefined>;
  abstract updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount">>,
  ): MaybePromise<NotificationJobRecord | undefined>;

  abstract insertFailedEvent(record: FailedEventRecord): MaybePromise<void>;
  abstract listFailedEvents(appId?: string): MaybePromise<FailedEventRecord[]>;
  abstract deleteFailedEvent(eventId: string): MaybePromise<void>;
  abstract updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): MaybePromise<void>;

  abstract listClientLogUploadTasks(appId?: string): MaybePromise<ClientLogUploadTaskRecord[]>;
  abstract findClientLogUploadTask(taskId: string): MaybePromise<ClientLogUploadTaskRecord | undefined>;
  abstract insertClientLogUploadTask(record: ClientLogUploadTaskRecord): MaybePromise<void>;
  abstract updateClientLogUploadTask(
    taskId: string,
    patch: Partial<
      Pick<
        ClientLogUploadTaskRecord,
        "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt" | "uploadedFileName" | "uploadedFilePath" | "uploadedFileSizeBytes" | "uploadedLineCount" | "failedAt" | "failureReason"
      >
    >,
  ): MaybePromise<void>;
  abstract insertClientLogUpload(record: ClientLogUploadRecord): MaybePromise<void>;
  abstract insertClientLogLines(records: ClientLogLineRecord[]): MaybePromise<void>;
}

export function buildManagedStateSnapshot(seed: DatabaseSeed = {}): ManagedStateSnapshot {
  return {
    apps: structuredClone(seed.apps ?? []),
    roles: structuredClone(seed.roles ?? []),
    rolePermissions: structuredClone(seed.rolePermissions ?? []),
    appConfigs: structuredClone(seed.appConfigs ?? []),
  };
}

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
} from "../shared/types.ts";
import {
  ApplicationDatabase,
  buildManagedStateSnapshot,
  type ManagedStateSnapshot,
} from "../infrastructure/database/application-database.ts";

/**
 * InMemoryDatabase is a test-only database double.
 */
export class InMemoryDatabase extends ApplicationDatabase {
  apps: AppRecord[];
  users: UserRecord[];
  appUsers: AppUserRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  rolePermissions: RolePermissionRecord[];
  userRoles: UserRoleRecord[];
  auditLogs: AuditLogRecord[];
  notificationJobs: NotificationJobRecord[];
  failedEvents: FailedEventRecord[];
  appConfigs: AppConfigRecord[];
  analyticsEvents: AnalyticsEventRecord[];
  files: FileRecord[];
  clientLogUploadTasks: ClientLogUploadTaskRecord[];
  clientLogUploads: ClientLogUploadRecord[];
  clientLogLines: ClientLogLineRecord[];

  constructor(seed: DatabaseSeed = {}) {
    super();
    this.apps = structuredClone(seed.apps ?? []);
    this.users = structuredClone(seed.users ?? []);
    this.appUsers = structuredClone(seed.appUsers ?? []);
    this.roles = structuredClone(seed.roles ?? []);
    this.permissions = structuredClone(seed.permissions ?? []);
    this.rolePermissions = structuredClone(seed.rolePermissions ?? []);
    this.userRoles = structuredClone(seed.userRoles ?? []);
    this.auditLogs = structuredClone(seed.auditLogs ?? []);
    this.notificationJobs = structuredClone(seed.notificationJobs ?? []);
    this.failedEvents = structuredClone(seed.failedEvents ?? []);
    this.appConfigs = structuredClone(seed.appConfigs ?? []);
    this.analyticsEvents = structuredClone(seed.analyticsEvents ?? []);
    this.files = structuredClone(seed.files ?? []);
    this.clientLogUploadTasks = structuredClone(seed.clientLogUploadTasks ?? []);
    this.clientLogUploads = structuredClone(seed.clientLogUploads ?? []);
    this.clientLogLines = structuredClone(seed.clientLogLines ?? []);
  }

  async withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T> {
    return await fn();
  }

  async close(): Promise<void> {
    return undefined;
  }

  exportManagedState(): ManagedStateSnapshot {
    return {
      apps: structuredClone(this.apps),
      roles: structuredClone(this.roles),
      rolePermissions: structuredClone(this.rolePermissions),
      appConfigs: structuredClone(this.appConfigs),
    };
  }

  listApps(): AppRecord[] {
    return this.apps;
  }

  listAppIds(): string[] {
    return this.apps.map((item) => item.id);
  }

  findApp(appId: string): AppRecord | undefined {
    return this.apps.find((item) => item.id === appId || item.code === appId);
  }

  findAppByApiDomain(hostname: string): AppRecord | undefined {
    const normalized = hostname.trim().toLowerCase();
    return this.apps.find((item) => item.apiDomain?.toLowerCase() === normalized);
  }

  insertApp(record: AppRecord): void {
    this.apps.push(structuredClone(record));
  }

  updateAppNames(appId: string, name: string, nameI18n: AppNameI18n): void {
    const app = this.findApp(appId);
    if (!app) {
      return;
    }

    app.name = name;
    app.nameI18n = structuredClone(nameI18n);
  }

  deleteApp(appId: string): void {
    const roleIds = this.roles.filter((item) => item.appId === appId).map((item) => item.id);
    this.apps = this.apps.filter((item) => item.id !== appId);
    this.appUsers = this.appUsers.filter((item) => item.appId !== appId);
    this.roles = this.roles.filter((item) => item.appId !== appId);
    this.userRoles = this.userRoles.filter((item) => item.appId !== appId);
    this.rolePermissions = this.rolePermissions.filter((item) => !roleIds.includes(item.roleId));
    this.auditLogs = this.auditLogs.filter((item) => item.appId !== appId);
    this.notificationJobs = this.notificationJobs.filter((item) => item.appId !== appId);
    this.failedEvents = this.failedEvents.filter((item) => item.appId !== appId);
    this.appConfigs = this.appConfigs.filter((item) => item.appId !== appId);
    this.analyticsEvents = this.analyticsEvents.filter((item) => item.appId !== appId);
    this.files = this.files.filter((item) => item.appId !== appId);
    this.clientLogUploadTasks = this.clientLogUploadTasks.filter((item) => item.appId !== appId);
    this.clientLogUploads = this.clientLogUploads.filter((item) => item.appId !== appId);
    this.clientLogLines = this.clientLogLines.filter((item) => item.appId !== appId);
  }

  listAppUsers(appId?: string): AppUserRecord[] {
    return appId ? this.appUsers.filter((item) => item.appId === appId) : this.appUsers;
  }

  findAppUser(appId: string, userId: string): AppUserRecord | undefined {
    return this.appUsers.find((item) => item.appId === appId && item.userId === userId);
  }

  insertAppUser(record: AppUserRecord): void {
    this.appUsers.push(structuredClone(record));
  }

  listRoles(appId?: string): RoleRecord[] {
    return appId ? this.roles.filter((item) => item.appId === appId) : this.roles;
  }

  findRole(appId: string, roleCode: string): RoleRecord | undefined {
    return this.roles.find((item) => item.appId === appId && item.code === roleCode);
  }

  insertRoles(records: RoleRecord[]): void {
    this.roles.push(...structuredClone(records));
  }

  listPermissions(): PermissionRecord[] {
    return this.permissions;
  }

  insertRolePermissions(records: RolePermissionRecord[]): void {
    this.rolePermissions.push(...structuredClone(records));
  }

  findUserRole(appId: string, userId: string, roleId: string): UserRoleRecord | undefined {
    return this.userRoles.find((item) => item.appId === appId && item.userId === userId && item.roleId === roleId);
  }

  insertUserRole(record: UserRoleRecord): void {
    this.userRoles.push(structuredClone(record));
  }

  getPermissionCodes(appId: string, userId: string): string[] {
    const roleIds = this.userRoles
      .filter((item) => item.appId === appId && item.userId === userId)
      .map((item) => item.roleId);
    const permissionIds = this.rolePermissions
      .filter((item) => roleIds.includes(item.roleId))
      .map((item) => item.permissionId);

    return this.permissions
      .filter((item) => permissionIds.includes(item.id))
      .map((item) => item.code);
  }

  findUserById(userId: string): UserRecord | undefined {
    return this.users.find((item) => item.id === userId);
  }

  findUserByAccount(account: string): UserRecord | undefined {
    const normalized = account.trim().toLowerCase();
    return this.users.find(
      (item) =>
        item.email?.toLowerCase() === normalized || item.phone?.toLowerCase() === normalized,
    );
  }

  insertUser(record: UserRecord): void {
    this.users.push(structuredClone(record));
  }

  updateUserPassword(userId: string, passwordHash: string, passwordAlgo: string): void {
    const user = this.findUserById(userId);
    if (!user) {
      return;
    }

    user.passwordHash = passwordHash;
    user.passwordAlgo = passwordAlgo;
  }

  insertAuditLog(record: AuditLogRecord): void {
    this.auditLogs.push(structuredClone(record));
  }

  listAppConfigs(appId?: string): AppConfigRecord[] {
    return appId ? this.appConfigs.filter((item) => item.appId === appId) : this.appConfigs;
  }

  findAppConfig(appId: string, configKey: string): AppConfigRecord | undefined {
    return this.appConfigs.find((item) => item.appId === appId && item.configKey === configKey);
  }

  upsertAppConfig(record: AppConfigRecord): AppConfigRecord {
    const existing = this.findAppConfig(record.appId, record.configKey);
    if (existing) {
      existing.configValue = record.configValue;
      existing.updatedAt = record.updatedAt;
      return existing;
    }

    const created = structuredClone(record);
    this.appConfigs.push(created);
    return created;
  }

  deleteAppConfigsByApp(appId: string): void {
    this.appConfigs = this.appConfigs.filter((item) => item.appId !== appId);
  }

  insertAnalyticsEvents(records: AnalyticsEventRecord[]): void {
    this.analyticsEvents.push(...structuredClone(records));
  }

  listAnalyticsEvents(appId: string): AnalyticsEventRecord[] {
    return this.analyticsEvents.filter((item) => item.appId === appId);
  }

  insertFile(record: FileRecord): void {
    this.files.push(structuredClone(record));
  }

  findFileByOwnerAndStorageKey(appId: string, ownerUserId: string, storageKey: string): FileRecord | undefined {
    return this.files.find(
      (item) => item.appId === appId && item.ownerUserId === ownerUserId && item.storageKey === storageKey,
    );
  }

  findFileByAppAndStorageKey(appId: string, storageKey: string): FileRecord | undefined {
    return this.files.find((item) => item.appId === appId && item.storageKey === storageKey);
  }

  confirmFile(fileId: string, mimeType: string, sizeBytes: number): FileRecord | undefined {
    const file = this.files.find((item) => item.id === fileId);
    if (!file) {
      return undefined;
    }

    file.status = "CONFIRMED";
    file.mimeType = mimeType;
    file.sizeBytes = sizeBytes;
    return file;
  }

  insertNotificationJob(record: NotificationJobRecord): void {
    this.notificationJobs.push(structuredClone(record));
  }

  findNotificationJob(jobId: string): NotificationJobRecord | undefined {
    return this.notificationJobs.find((item) => item.id === jobId);
  }

  updateNotificationJob(
    jobId: string,
    patch: Partial<Pick<NotificationJobRecord, "status" | "retryCount">>,
  ): NotificationJobRecord | undefined {
    const job = this.findNotificationJob(jobId);
    if (!job) {
      return undefined;
    }

    if (patch.status) {
      job.status = patch.status;
    }
    if (typeof patch.retryCount === "number") {
      job.retryCount = patch.retryCount;
    }
    return job;
  }

  insertFailedEvent(record: FailedEventRecord): void {
    this.failedEvents.push(structuredClone(record));
  }

  listFailedEvents(appId?: string): FailedEventRecord[] {
    return appId ? this.failedEvents.filter((item) => item.appId === appId) : this.failedEvents;
  }

  deleteFailedEvent(eventId: string): void {
    this.failedEvents = this.failedEvents.filter((item) => item.id !== eventId);
  }

  updateFailedEvent(
    eventId: string,
    patch: Pick<FailedEventRecord, "retryCount" | "errorMessage" | "nextRetryAt">,
  ): void {
    const event = this.failedEvents.find((item) => item.id === eventId);
    if (!event) {
      return;
    }

    event.retryCount = patch.retryCount;
    event.errorMessage = patch.errorMessage;
    event.nextRetryAt = patch.nextRetryAt;
  }

  listClientLogUploadTasks(appId?: string): ClientLogUploadTaskRecord[] {
    return appId ? this.clientLogUploadTasks.filter((item) => item.appId === appId) : this.clientLogUploadTasks;
  }

  findClientLogUploadTask(taskId: string): ClientLogUploadTaskRecord | undefined {
    return this.clientLogUploadTasks.find((item) => item.id === taskId);
  }

  insertClientLogUploadTask(record: ClientLogUploadTaskRecord): void {
    this.clientLogUploadTasks.push(structuredClone(record));
  }

  updateClientLogUploadTask(
    taskId: string,
    patch: Partial<Pick<ClientLogUploadTaskRecord, "status" | "did" | "claimToken" | "claimExpireAt" | "uploadedAt">>,
  ): void {
    const task = this.findClientLogUploadTask(taskId);
    if (!task) {
      return;
    }

    if ("status" in patch) {
      task.status = patch.status;
    }
    if ("did" in patch) {
      task.did = patch.did;
    }
    if ("claimToken" in patch) {
      task.claimToken = patch.claimToken;
    }
    if ("claimExpireAt" in patch) {
      task.claimExpireAt = patch.claimExpireAt;
    }
    if ("uploadedAt" in patch) {
      task.uploadedAt = patch.uploadedAt;
    }
  }

  insertClientLogUpload(record: ClientLogUploadRecord): void {
    this.clientLogUploads.push(structuredClone(record));
  }

  insertClientLogLines(records: ClientLogLineRecord[]): void {
    this.clientLogLines.push(...structuredClone(records));
  }

  get seedManagedState(): ManagedStateSnapshot {
    return buildManagedStateSnapshot({
      apps: this.apps,
      roles: this.roles,
      rolePermissions: this.rolePermissions,
      appConfigs: this.appConfigs,
    });
  }
}

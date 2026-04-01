import type {
  AnalyticsEventRecord,
  AppConfigRecord,
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
  RefreshTokenRecord,
  RolePermissionRecord,
  RoleRecord,
  UserRecord,
  UserRoleRecord,
} from "../../../shared/types.ts";

export interface DatabaseStateSnapshot {
  apps: AppRecord[];
  users: UserRecord[];
  appUsers: AppUserRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  rolePermissions: RolePermissionRecord[];
  userRoles: UserRoleRecord[];
  refreshTokens: RefreshTokenRecord[];
  auditLogs: AuditLogRecord[];
  notificationJobs: NotificationJobRecord[];
  failedEvents: FailedEventRecord[];
  appConfigs: AppConfigRecord[];
  analyticsEvents: AnalyticsEventRecord[];
  files: FileRecord[];
  clientLogUploadTasks: ClientLogUploadTaskRecord[];
  clientLogUploads: ClientLogUploadRecord[];
  clientLogLines: ClientLogLineRecord[];
}

/**
 * InMemoryDatabase mirrors the documented tables so the design can be exercised without infra setup.
 */
export class InMemoryDatabase {
  apps: AppRecord[];
  users: UserRecord[];
  appUsers: AppUserRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  rolePermissions: RolePermissionRecord[];
  userRoles: UserRoleRecord[];
  refreshTokens: RefreshTokenRecord[];
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
    this.apps = structuredClone(seed.apps ?? []);
    this.users = structuredClone(seed.users ?? []);
    this.appUsers = structuredClone(seed.appUsers ?? []);
    this.roles = structuredClone(seed.roles ?? []);
    this.permissions = structuredClone(seed.permissions ?? []);
    this.rolePermissions = structuredClone(seed.rolePermissions ?? []);
    this.userRoles = structuredClone(seed.userRoles ?? []);
    this.refreshTokens = structuredClone(seed.refreshTokens ?? []);
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

  findApp(appId: string): AppRecord | undefined {
    return this.apps.find((item) => item.id === appId || item.code === appId);
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

  findAppUser(appId: string, userId: string): AppUserRecord | undefined {
    return this.appUsers.find((item) => item.appId === appId && item.userId === userId);
  }

  findRole(appId: string, roleCode: string): RoleRecord | undefined {
    return this.roles.find((item) => item.appId === appId && item.code === roleCode);
  }

  getUserRoles(appId: string, userId: string): RoleRecord[] {
    const roleIds = this.userRoles
      .filter((item) => item.appId === appId && item.userId === userId)
      .map((item) => item.roleId);

    return this.roles.filter((item) => roleIds.includes(item.id));
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

  cloneState(): DatabaseStateSnapshot {
    return {
      apps: structuredClone(this.apps),
      users: structuredClone(this.users),
      appUsers: structuredClone(this.appUsers),
      roles: structuredClone(this.roles),
      permissions: structuredClone(this.permissions),
      rolePermissions: structuredClone(this.rolePermissions),
      userRoles: structuredClone(this.userRoles),
      refreshTokens: structuredClone(this.refreshTokens),
      auditLogs: structuredClone(this.auditLogs),
      notificationJobs: structuredClone(this.notificationJobs),
      failedEvents: structuredClone(this.failedEvents),
      appConfigs: structuredClone(this.appConfigs),
      analyticsEvents: structuredClone(this.analyticsEvents),
      files: structuredClone(this.files),
      clientLogUploadTasks: structuredClone(this.clientLogUploadTasks),
      clientLogUploads: structuredClone(this.clientLogUploads),
      clientLogLines: structuredClone(this.clientLogLines),
    };
  }

  replaceState(next: Partial<DatabaseStateSnapshot>): void {
    this.apps = structuredClone(next.apps ?? []);
    this.users = structuredClone(next.users ?? []);
    this.appUsers = structuredClone(next.appUsers ?? []);
    this.roles = structuredClone(next.roles ?? []);
    this.permissions = structuredClone(next.permissions ?? []);
    this.rolePermissions = structuredClone(next.rolePermissions ?? []);
    this.userRoles = structuredClone(next.userRoles ?? []);
    this.refreshTokens = structuredClone(next.refreshTokens ?? []);
    this.auditLogs = structuredClone(next.auditLogs ?? []);
    this.notificationJobs = structuredClone(next.notificationJobs ?? []);
    this.failedEvents = structuredClone(next.failedEvents ?? []);
    this.appConfigs = structuredClone(next.appConfigs ?? []);
    this.analyticsEvents = structuredClone(next.analyticsEvents ?? []);
    this.files = structuredClone(next.files ?? []);
    this.clientLogUploadTasks = structuredClone(next.clientLogUploadTasks ?? []);
    this.clientLogUploads = structuredClone(next.clientLogUploads ?? []);
    this.clientLogLines = structuredClone(next.clientLogLines ?? []);
  }

  async withExclusiveSession<T>(fn: () => Promise<T> | T): Promise<T> {
    return await fn();
  }

  async close(): Promise<void> {
    return undefined;
  }
}

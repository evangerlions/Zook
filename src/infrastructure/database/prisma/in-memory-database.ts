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
}
